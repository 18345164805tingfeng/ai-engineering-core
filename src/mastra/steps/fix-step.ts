import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { defaultExecutorRouter } from '../../router/executor-router.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const fixInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  reviewResult: ReviewResultSchema,
});

export const fixOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const fixStep = createStep({
  id: 'fix-step',
  inputSchema: fixInputSchema,
  outputSchema: fixOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;
    const reviewResult = inputData.reviewResult;

    await executeTrackedStep(task, 'fix', async () => {
      task.status = 'FIXING';
      await defaultTaskStore.updateStatus(task.id, 'FIXING', {
        summary: `Developer 正在针对 ${reviewResult.issues?.length || 0} 个 Review 问题进行修复`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'fix.started',
        summary: `Developer 开始修复 ${reviewResult.issues?.length || 0} 个 Review 问题`,
        data: {
          round: task.execution.round,
          issuesCount: reviewResult.issues?.length || 0,
        },
      }).catch(() => {});

      const devResp = await defaultExecutorRouter.executeRole({
        role: 'developer',
        task,
        projectContext,
        instruction: `Fix review issues: ${JSON.stringify(reviewResult.issues)}`,
        contextData: { reviewResult },
      });

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'fix.completed',
        summary: `Developer 修复轮次已完成`,
        data: { round: task.execution.round },
      }).catch(() => {});

      return {
        status: devResp.success ? ('COMPLETED' as const) : ('FAILED' as const),
        executor: devResp.executorId,
        summary: `Developer 针对 ${reviewResult.issues?.length || 0} 个问题完成代码修改`,
        data: { round: task.execution.round },
      };
    });

    return { task, projectContext };
  },
});
