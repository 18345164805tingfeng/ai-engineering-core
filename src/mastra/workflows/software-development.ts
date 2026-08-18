import { createWorkflow } from '@mastra/core/workflows';
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
import {
  loadContextStep,
  analyzeTaskStep,
  planTaskStep,
  acquireWorkspaceStep,
  developStep,
  verifyStep,
  reviewStep,
  fixStep,
  arbitrateStep,
  finalizeStep,
  releaseWorkspaceStep,
  applyModelFileChanges,
} from '../steps/index.js';

export interface WorkflowOptions {
  executorRouter?: ExecutorRouter;
  maxRounds?: number;
  testRunner?: (role: any, context: ProjectContext) => Promise<ProcessResult>;
  skipPlanning?: boolean;
}

export const softwareDevelopmentInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema.optional(),
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

export { applyModelFileChanges };

/**
 * Multi-Step Software Development Loop with fine-grained Step tracking
 */
export async function executeSoftwareDevelopmentLoop(
  task: InternalTask,
  projectContext: ProjectContext,
  options: WorkflowOptions = {}
) {
  const router = options.executorRouter || defaultExecutorRouter;
  const maxRounds = options.maxRounds || 3;
  const testRunner = options.testRunner || runTestTool;

  // Initialize workflow and run IDs
  const runId = task.workflow?.runId || `RUN-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  let currentTask: InternalTask = {
    ...task,
    workflow: {
      workflowId: 'software-development',
      runId,
      currentStep: 'load-context',
    },
    steps: task.steps || [],
    workspace: {
      id: `ws-${task.project.id}-${task.id}`,
      mode: 'shared-lock',
      root: projectContext.projectRoot,
      branch: projectContext.git?.branch || 'main',
      baseBranch: 'main',
    },
    scheduling: {
      status: 'RUNNING',
      queuedAt: task.scheduling?.queuedAt || new Date().toISOString(),
      startedAt: new Date().toISOString(),
      waitingReason: null,
    },
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
    type: 'workflow.run.started',
    summary: `Workflow run '${runId}' started for task ${currentTask.id}`,
    data: { runId, projectId: projectContext.projectId, mode: currentTask.mode },
  }).catch(() => {});

  // Step 0: Planning (Planner Role)
  if (!options.skipPlanning) {
    currentTask.workflow.currentStep = 'plan-task';
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
  currentTask.workflow.currentStep = 'develop';
  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'development.started',
    summary: `Developer role started coding`,
    data: { round: 0, runId },
  }).catch(() => {});

  const devResp = await router.executeRole({
    role: 'developer',
    task: currentTask,
    projectContext,
    prompt: `Develop feature: ${currentTask.requirement.title}\nPlan: ${JSON.stringify(currentTask.plan)}`,
  });

  if (!devResp.success) {
    currentTask.status = 'FAILED';
    currentTask.workflow.currentStep = 'develop';
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'task.failed',
      summary: 'Developer initial coding failed',
      data: { error: devResp.error, runId },
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
    currentTask.workflow.currentStep = 'verify';
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'verification.started',
      summary: `Verification started for round ${round}`,
      data: { round, runId },
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
    currentTask.workflow.currentStep = 'review';
    await defaultTaskStore.appendTimeline(currentTask.id, {
      type: 'review.started',
      summary: `Review started for round ${round}`,
      data: { round, runId },
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
      currentTask.workflow.currentStep = 'finalize';
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'task.completed',
        summary: `Task ${currentTask.id} completed successfully in round ${round}`,
        data: { rounds: round, result: 'PASS', runId },
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
      currentTask.workflow.currentStep = 'fix';
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'fix.started',
        summary: `Developer started fixing ${finalReview.issues?.length || 0} review issues`,
        data: { round, issuesCount: finalReview.issues?.length || 0, runId },
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
  currentTask.workflow.currentStep = 'arbitrate';
  await defaultTaskStore.appendTimeline(currentTask.id, {
    type: 'arbitration.started',
    summary: `Task reached maximum review rounds (${maxRounds}), entering architect arbitration`,
    data: { maxRounds, runId },
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
    currentTask.workflow.currentStep = 'fix';
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
    currentTask.workflow.currentStep = 'verify';
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
    currentTask.workflow.currentStep = 'review';
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
      currentTask.workflow.currentStep = 'finalize';
      await defaultTaskStore.appendTimeline(currentTask.id, {
        type: 'task.completed',
        summary: `Task completed after final architect fix round`,
        data: { rounds: maxRounds + 1, result: 'PASS', runId },
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
    currentTask.workflow.currentStep = 'finalize';
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
    currentTask.workflow.currentStep = 'finalize';
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
  currentTask.workflow.currentStep = 'finalize';
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

/**
 * Mastra Multi-Step Decomposed Workflow definition
 */
export const softwareDevelopmentWorkflow = createWorkflow({
  id: 'software-development-workflow',
  inputSchema: softwareDevelopmentInputSchema,
  outputSchema: softwareDevelopmentOutputSchema,
})
  .then(loadContextStep)
  .then(analyzeTaskStep)
  .then(planTaskStep)
  .then(acquireWorkspaceStep)
  .then(developStep)
  .then(verifyStep)
  .then(reviewStep)
  .then(finalizeStep)
  .then(releaseWorkspaceStep)
  .commit();

export * from '../steps/index.js';
