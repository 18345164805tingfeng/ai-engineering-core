import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask, TaskArbitrationSchema } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { defaultExecutorRouter } from '../../router/executor-router.js';
import { runArchitectRole } from '../agents/architect.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { executeTrackedStep } from './step-context.js';

export const arbitrateInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  reviewHistory: z.array(ReviewResultSchema).default([]),
});

export const arbitrateOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  arbitration: TaskArbitrationSchema,
});

export const arbitrateStep = createStep({
  id: 'arbitrate-step',
  inputSchema: arbitrateInputSchema,
  outputSchema: arbitrateOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;
    const reviewHistory = inputData.reviewHistory;

    let arbitrationResult: any;

    await executeTrackedStep(task, 'arbitrate', async () => {
      task.status = 'NEED_ARBITRATION';
      await defaultTaskStore.updateStatus(task.id, 'NEED_ARBITRATION', {
        summary: `达到最大迭代轮次，正在进入 Architect 架构师仲裁`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'arbitration.started',
        summary: `进入 Architect 架构师仲裁流程`,
      }).catch(() => {});

      arbitrationResult = await runArchitectRole(defaultExecutorRouter, task, projectContext, reviewHistory);
      task.arbitration = arbitrationResult;

      const arbitrationArtifact = await defaultArtifactStore.createArtifact({
        taskId: task.id,
        type: 'arbitration_detail',
        data: arbitrationResult,
      });

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'arbitration.completed',
        summary: `架构师仲裁决策完成：${arbitrationResult.decision}`,
        artifactId: arbitrationArtifact.id,
        data: {
          decision: arbitrationResult.decision,
          feedback: arbitrationResult.feedback,
        },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: `仲裁决策：${arbitrationResult.decision}`,
        artifactIds: [arbitrationArtifact.id],
        data: { decision: arbitrationResult.decision },
      };
    });

    return { task, projectContext, arbitration: arbitrationResult };
  },
});
