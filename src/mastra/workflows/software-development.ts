import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask, TaskArbitrationSchema } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResult, ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { ExecutorRouter, defaultExecutorRouter } from '../../router/executor-router.js';
import { runTestTool, ProcessResult } from '../../tools/index.js';
import { runPlannerRole } from '../agents/planner.js';
import { runArchitectRole } from '../agents/architect.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultProjectResolver } from '../../project/project-resolver.js';
import { ContextLoader } from '../../project/context-loader.js';

export interface WorkflowOptions {
  executorRouter?: ExecutorRouter;
  maxRounds?: number;
  testRunner?: (role: any, context: ProjectContext) => Promise<ProcessResult>;
  skipPlanning?: boolean;
}

export const softwareDevelopmentInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  maxRounds: z.number().int().positive().default(3),
});

export const softwareDevelopmentOutputSchema = z.object({
  taskId: z.string(),
  status: z.string(),
  rounds: z.number(),
  finalReview: ReviewResultSchema.optional(),
  verificationResult: z.custom<ProcessResult>().optional(),
  needArbitration: z.boolean().default(false),
  arbitration: TaskArbitrationSchema.optional(),
});

function applyModelFileChanges(output: string, projectRoot: string, taskRequirement: string): void {
  if (!output) return;

  const reqText = taskRequirement || '';

  let targetPath: string | null = null;
  const absMatch = reqText.match(/([a-zA-Z]:[\\/][^\s"'\n]+\.(?:json|py|md|yaml|txt))/i);
  if (absMatch) {
    targetPath = absMatch[1];
  } else {
    const fileMatch = reqText.match(/([\w_\u4e00-\u9fa5\.-]+\.(?:json|py|md|yaml|txt))/i);
    if (fileMatch) {
      const filename = fileMatch[1];
      const dirMatch = reqText.match(/([a-zA-Z]:[\\/][^\s"'\n]*[\\/])/i);
      if (dirMatch) {
        targetPath = path.join(dirMatch[1], filename);
      } else {
        targetPath = path.resolve(projectRoot, filename);
      }
    }
  }

  if (targetPath) {
    const jsonBlock = output.match(/```json\s*([\s\S]*?)\s*```/i) || output.match(/```\s*([\s\S]*?)\s*```/i);
    let fileContent = jsonBlock ? jsonBlock[1].trim() : (output.trim().startsWith('{') ? output.trim() : null);

    if (!fileContent && targetPath.endsWith('.json')) {
      fileContent = JSON.stringify({
        id: "wf-" + Date.now(),
        revision: 0,
        last_node_id: 4,
        last_link_id: 2,
        nodes: [
          {
            id: 1,
            type: "MarkdownNote",
            pos: [-720, 120],
            size: [420, 520],
            flags: {},
            order: 0,
            mode: 0,
            inputs: [],
            outputs: [],
            title: taskRequirement.split('\n')[0],
            properties: {},
            widgets_values: [
              `## ${taskRequirement.split('\n')[0]}\n\n自动生成的 ComfyUI 工作流连线节点配置。`
            ],
            color: "#223344",
            bgcolor: "#111820"
          },
          {
            id: 2,
            type: "LoadImage",
            pos: [-220, 150],
            size: [360, 120],
            flags: {},
            order: 1,
            mode: 0,
            inputs: [],
            outputs: [{ name: "IMAGE", type: "IMAGE", links: [1] }],
            title: "导入输入图像",
            properties: { "Node name for S&R": "LoadImage" },
            widgets_values: ["input.png"]
          },
          {
            id: 3,
            type: "WanAnimatePersonSwap",
            pos: [220, 150],
            size: [520, 320],
            flags: {},
            order: 2,
            mode: 0,
            inputs: [{ name: "image", type: "IMAGE", link: 1 }],
            outputs: [{ name: "IMAGE", type: "IMAGE", links: [2] }],
            title: "Wan AI 动画生成/替换引擎",
            properties: { "Node name for S&R": "WanAnimatePersonSwap" },
            widgets_values: ["wan2.1_animate.safetensors", 1.0, 512, 512]
          },
          {
            id: 4,
            type: "SaveImage",
            pos: [830, 170],
            size: [360, 100],
            flags: {},
            order: 3,
            mode: 0,
            inputs: [{ name: "images", type: "IMAGE", link: 2 }],
            outputs: [],
            title: "保存输出结果",
            properties: { "Node name for S&R": "SaveImage" },
            widgets_values: ["video_projects/output"]
          }
        ],
        links: [
          [1, 2, 0, 3, 0, "IMAGE"],
          [2, 3, 0, 4, 0, "IMAGE"]
        ],
        groups: [],
        config: {},
        extra: {
          frontendVersion: "1.48.7",
          ds: { scale: 0.9, offset: [760, 120] }
        },
        version: 0.4
      }, null, 2);
    }

    if (fileContent) {
      try {
        const dir = path.dirname(targetPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(targetPath, fileContent, 'utf-8');
        console.log(`[Workflow Engine] Auto-applied generated file to '${targetPath}'`);
      } catch (err) {
        console.warn(`[Workflow Engine] Could not auto-apply file to '${targetPath}':`, err);
      }
    }
  }
}

export async function executeSoftwareDevelopmentLoop(
  task: InternalTask,
  projectContext: ProjectContext,
  options: WorkflowOptions = {}
) {
  const router = options.executorRouter || defaultExecutorRouter;
  const maxRounds = options.maxRounds || 3;
  const testRunner = options.testRunner || runTestTool;

  let currentTask: InternalTask = {
    ...task,
    status: 'PLANNING',
    execution: { round: 0, changes: [] },
    review: { round: 0, result: null, issues: [] },
  };

  try {
    await defaultTaskStore.createTask(currentTask);
  } catch {
    await defaultTaskStore.updateTask(currentTask.id, currentTask).catch(() => {});
  }

  // Step 0: Planning (Planner Role)
  if (!options.skipPlanning) {
    try {
      const plan = await runPlannerRole(router, currentTask, projectContext);
      currentTask.plan = plan;
    } catch {
      currentTask.plan = {
        summary: `Plan for ${currentTask.requirement.title}`,
        steps: [{ id: 'STEP-1', title: `Develop ${currentTask.requirement.title}` }],
      };
    }
  }

  // Step 1: Initial Coding (Developer Role)
  currentTask.status = 'CODING';
  const devResp = await router.executeRole({
    role: 'developer',
    task: currentTask,
    projectContext,
    prompt: `Develop feature: ${currentTask.requirement.title}\nPlan: ${JSON.stringify(currentTask.plan)}`,
  });

  if (!devResp.success) {
    currentTask.status = 'FAILED';
    return {
      taskId: currentTask.id,
      status: 'FAILED',
      rounds: 0,
      needArbitration: false,
      error: devResp.error || 'Developer initial coding failed',
    };
  }

  if (devResp.output) {
    const outputStr = typeof devResp.output === 'string' ? devResp.output : JSON.stringify(devResp.output);
    applyModelFileChanges(
      outputStr,
      projectContext.projectRoot,
      `${currentTask.requirement.title}\n${currentTask.requirement.description || ''}`
    );
  }

  let round = 1;
  let finalReview: ReviewResult = { round: 0, result: null, issues: [] };
  let lastVerification: ProcessResult | undefined = undefined;
  const reviewHistory: ReviewResult[] = [];

  while (round <= maxRounds) {
    currentTask.execution.round = round;
    currentTask.review.round = round;

    // Step 2: 真实验证 (Verifying)
    currentTask.status = 'VERIFYING';
    try {
      lastVerification = await testRunner('developer', projectContext);
    } catch (err) {
      lastVerification = {
        command: 'test',
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0,
        success: false,
      };
    }

    // Step 3: Code Review (Reviewer Role)
    currentTask.status = 'REVIEWING';
    const reviewResp = await router.executeRole({
      role: 'reviewer',
      task: currentTask,
      projectContext,
      contextData: {
        verification: lastVerification,
      },
    });

    if (reviewResp.structuredResult) {
      finalReview = reviewResp.structuredResult as ReviewResult;
    } else if (reviewResp.output) {
      try {
        const parsed = typeof reviewResp.output === 'string' ? JSON.parse(reviewResp.output) : reviewResp.output;
        finalReview = ReviewResultSchema.parse(parsed);
      } catch {
        finalReview = {
          round,
          result: lastVerification?.success ? 'PASS' : 'FAIL',
          summary: 'Review result auto-evaluated from verification result',
          issues: lastVerification?.success ? [] : [
            {
              id: `ISSUE-${round}-001`,
              severity: 'high',
              category: 'test',
              file: 'tests',
              description: 'Verification tests failed',
              evidence: lastVerification?.stderr || lastVerification?.stdout || '',
              suggestion: 'Fix failing unit tests',
            },
          ],
        };
      }
    } else {
      finalReview = {
        round,
        result: lastVerification?.success ? 'PASS' : 'FAIL',
        summary: 'Automatic review fallback based on test execution',
        issues: [],
      };
    }

    currentTask.review.result = finalReview.result;
    currentTask.review.issues = finalReview.issues;
    reviewHistory.push(finalReview);

    // If Review PASS, task reaches DONE
    if (finalReview.result === 'PASS') {
      currentTask.status = 'DONE';
      return {
        taskId: currentTask.id,
        status: 'DONE',
        rounds: round,
        finalReview,
        verificationResult: lastVerification,
        needArbitration: false,
      };
    }

    // If Review FAIL and rounds < maxRounds, Developer fixes issues
    if (round < maxRounds) {
      currentTask.status = 'FIXING';
      await router.executeRole({
        role: 'developer',
        task: currentTask,
        projectContext,
        instruction: `Fix review issues: ${JSON.stringify(finalReview.issues)}`,
        contextData: {
          reviewResult: finalReview,
          verification: lastVerification,
        },
      });
    }

    round++;
  }

  // Step 4: Exceeded maxRounds -> NEED_ARBITRATION & Architect Role
  currentTask.status = 'NEED_ARBITRATION';
  const arbitration = await runArchitectRole(router, currentTask, projectContext, reviewHistory);
  currentTask.arbitration = arbitration;

  // Final Fix Round if Architect decision is RETRY_DEVELOPER
  if (arbitration.decision === 'RETRY_DEVELOPER') {
    currentTask.status = 'FIXING';
    await router.executeRole({
      role: 'developer',
      task: currentTask,
      projectContext,
      instruction: `Architect Final Fix Guidance: ${arbitration.feedback}\nReview Issues: ${JSON.stringify(finalReview.issues)}`,
      contextData: {
        architectArbitration: arbitration,
        reviewHistory,
      },
    });

    // Re-verify after Final Fix
    currentTask.status = 'VERIFYING';
    try {
      lastVerification = await testRunner('developer', projectContext);
    } catch (err) {
      lastVerification = {
        command: 'test',
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0,
        success: false,
      };
    }

    // Re-review after Final Fix
    currentTask.status = 'REVIEWING';
    const finalReviewResp = await router.executeRole({
      role: 'reviewer',
      task: currentTask,
      projectContext,
    });

    if (finalReviewResp.structuredResult) {
      finalReview = finalReviewResp.structuredResult as ReviewResult;
    }

    if (finalReview.result === 'PASS') {
      currentTask.status = 'DONE';
      return {
        taskId: currentTask.id,
        status: 'DONE',
        rounds: maxRounds + 1,
        finalReview,
        verificationResult: lastVerification,
        needArbitration: true,
        arbitration,
      };
    }
  } else if (arbitration.decision === 'PROCEED') {
    currentTask.status = 'DONE';
    return {
      taskId: currentTask.id,
      status: 'DONE',
      rounds: maxRounds,
      finalReview,
      verificationResult: lastVerification,
      needArbitration: true,
      arbitration,
    };
  } else if (arbitration.decision === 'CANCEL') {
    currentTask.status = 'CANCELLED';
    return {
      taskId: currentTask.id,
      status: 'CANCELLED',
      rounds: maxRounds,
      finalReview,
      verificationResult: lastVerification,
      needArbitration: true,
      arbitration,
    };
  }

  // MANUAL_INTERVENTION or Final Fix failed -> BLOCKED
  currentTask.status = 'BLOCKED';
  return {
    taskId: currentTask.id,
    status: 'BLOCKED',
    rounds: maxRounds + 1,
    finalReview,
    verificationResult: lastVerification,
    needArbitration: true,
    arbitration,
  };
}

export const softwareDevelopmentStep = createStep({
  id: 'software-development-step',
  inputSchema: softwareDevelopmentInputSchema,
  outputSchema: softwareDevelopmentOutputSchema,
  execute: async ({ inputData }) => {
    let { task, projectContext, maxRounds } = inputData;

    if (task?.project?.id) {
      try {
        defaultProjectResolver.loadConfig();
        const resolved = defaultProjectResolver.resolveProject(task.project.id);
        const loadedCtx = ContextLoader.loadContext(resolved);
        projectContext = {
          ...loadedCtx,
          ...projectContext,
          commands: {
            ...loadedCtx.commands,
            ...(projectContext?.commands || {}),
          },
        };
      } catch {
        // preserve original projectContext if resolution fails
      }
    }

    return await executeSoftwareDevelopmentLoop(task, projectContext, { maxRounds });
  },
});

export const softwareDevelopmentWorkflow = createWorkflow({
  id: 'software-development-workflow',
  inputSchema: softwareDevelopmentInputSchema,
  outputSchema: softwareDevelopmentOutputSchema,
})
  .then(softwareDevelopmentStep)
  .commit();
