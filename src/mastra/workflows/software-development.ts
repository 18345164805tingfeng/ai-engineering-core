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
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { defaultProjectResolver } from '../../project/project-resolver.js';
import { ContextLoader } from '../../project/context-loader.js';
import { ProjectPathGuard } from '../../security/project-path-guard.js';

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
    // ProjectPathGuard security validation
    try {
      targetPath = ProjectPathGuard.validatePath(projectRoot, targetPath);
    } catch (guardErr) {
      console.warn(`[Security Guard] Blocked unsafe file write to '${targetPath}':`, guardErr);
      return;
    }

    const jsonBlock = output.match(/```json\s*([\s\S]*?)\s*```/i) || output.match(/```\s*([\s\S]*?)\s*```/i);
    let fileContent = jsonBlock ? jsonBlock[1].trim() : (output.trim().startsWith('{') ? output.trim() : null);

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

  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'task.started',
    summary: `Workflow execution started for task ${currentTask.id}`,
    data: { projectId: projectContext.projectId, mode: currentTask.mode },
  }).catch(() => {});

  // Step 0: Planning (Planner Role)
  if (!options.skipPlanning) {
    try {
      const plan = await runPlannerRole(router, currentTask, projectContext);
      if (plan) {
        currentTask.plan = plan;

        const planArtifact = await defaultArtifactStore.createArtifact({
          taskId: currentTask.id,
          type: 'plan_detail',
          data: plan,
        });

        await defaultTaskStore.appendTimeline(currentTask.id, {
          type: 'plan.completed',
          summary: `Plan generated with ${plan.steps?.length || 0} steps`,
          artifactId: planArtifact.id,
          data: { stepCount: plan.steps?.length || 0, summary: plan.summary },
        }).catch(() => {});
      }
    } catch {
      currentTask.plan = {
        summary: `Plan for ${currentTask.requirement.title}`,
        steps: [{ id: 'STEP-1', title: `Develop ${currentTask.requirement.title}` }],
      };
    }
  }

  // Step 1: Initial Coding (Developer Role)
  currentTask.status = 'CODING';
  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'development.started',
    summary: `Developer role started coding`,
    data: { round: 0 },
  }).catch(() => {});

  const devResp = await router.executeRole({
    role: 'developer',
    task: currentTask,
    projectContext,
    prompt: `Develop feature: ${currentTask.requirement.title}\nPlan: ${JSON.stringify(currentTask.plan)}`,
  });

  if (!devResp.success) {
    currentTask.status = 'FAILED';
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'task.failed',
      summary: 'Developer initial coding failed',
      data: { error: devResp.error },
    }).catch(() => {});

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
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'verification.started',
      summary: `Verification started for round ${round}`,
      data: { round },
    }).catch(() => {});

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

    const testArtifact = await defaultArtifactStore.createArtifact({
      taskId: currentTask.id,
      type: 'test_log',
      data: {
        command: lastVerification.command,
        exitCode: lastVerification.exitCode,
        stdout: lastVerification.stdout,
        stderr: lastVerification.stderr,
      },
    });

    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'verification.completed',
      summary: `Verification completed: ${lastVerification.success ? 'PASSED' : 'FAILED'} (ExitCode: ${lastVerification.exitCode})`,
      artifactId: testArtifact.id,
      data: {
        success: lastVerification.success,
        exitCode: lastVerification.exitCode,
        durationMs: lastVerification.durationMs,
      },
    }).catch(() => {});

    // Step 3: Code Review (Reviewer Role)
    currentTask.status = 'REVIEWING';
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'review.started',
      summary: `Review started for round ${round}`,
      data: { round },
    }).catch(() => {});

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

    const reviewArtifact = await defaultArtifactStore.createArtifact({
      taskId: currentTask.id,
      type: 'review_detail',
      data: finalReview,
    });

    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'review.completed',
      summary: `Review round ${round} finished with result: ${finalReview.result}`,
      artifactId: reviewArtifact.id,
      data: {
        round,
        result: finalReview.result,
        issuesCount: finalReview.issues?.length || 0,
      },
    }).catch(() => {});

    // If Review PASS, task reaches DONE
    if (finalReview.result === 'PASS') {
      currentTask.status = 'DONE';
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'task.completed',
        summary: `Task ${currentTask.id} completed successfully in round ${round}`,
        data: { rounds: round, result: 'PASS' },
      }).catch(() => {});

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
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'fix.started',
        summary: `Developer started fixing ${finalReview.issues?.length || 0} review issues`,
        data: { round, issuesCount: finalReview.issues?.length || 0 },
      }).catch(() => {});

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
  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'arbitration.started',
    summary: `Task reached maximum review rounds (${maxRounds}), entering architect arbitration`,
    data: { maxRounds },
  }).catch(() => {});

  const arbitration = await runArchitectRole(router, currentTask, projectContext, reviewHistory);
  currentTask.arbitration = arbitration;

  const arbitrationArtifact = await defaultArtifactStore.createArtifact({
    taskId: currentTask.id,
    type: 'arbitration_detail',
    data: arbitration,
  });

  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'arbitration.completed',
    summary: `Architect arbitration decision: ${arbitration.decision}`,
    artifactId: arbitrationArtifact.id,
    data: { decision: arbitration.decision, feedback: arbitration.feedback },
  }).catch(() => {});

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
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'task.completed',
        summary: `Task completed after final architect fix round`,
        data: { rounds: maxRounds + 1, result: 'PASS' },
      }).catch(() => {});

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
