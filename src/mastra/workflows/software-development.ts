import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask, TaskArbitrationSchema } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResult, ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { ExecutorRouter, defaultExecutorRouter } from '../../router/executor-router.js';
import { runTestTool, ProcessResult } from '../../tools/index.js';
import { runPlannerRole } from '../agents/planner.js';
import { runArchitectRole } from '../agents/architect.js';

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
    const { task, projectContext, maxRounds } = inputData;
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
