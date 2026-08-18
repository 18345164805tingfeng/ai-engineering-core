import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { TaskStatus } from '../../task/state/task-state.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const finalizeInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  reviewResult: ReviewResultSchema,
});

export const finalizeOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  finalStatus: z.string(),
});

export const finalizeStep = createStep({
  id: 'finalize-step',
  inputSchema: finalizeInputSchema,
  outputSchema: finalizeOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;
    const reviewResult = inputData.reviewResult;
    const finalStatus: TaskStatus = reviewResult?.result === 'PASS' ? 'DONE' : 'FAILED';

    await executeTrackedStep(task, 'finalize', async () => {
      task.status = finalStatus;
      await defaultTaskStore.updateStatus(task.id, finalStatus, {
        summary: `任务终态已确定：[${finalStatus}]`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: finalStatus === 'DONE' ? 'task.completed' : 'task.failed',
        summary: `任务最终执行完毕，状态为 [${finalStatus}]`,
        data: {
          finalStatus,
          rounds: task.execution.round,
        },
      }).catch(() => {});

      return {
        status: finalStatus === 'DONE' ? ('COMPLETED' as const) : ('FAILED' as const),
        summary: `任务已完成，最终状态：${finalStatus}`,
        data: { finalStatus },
      };
    });

    return { task, projectContext, finalStatus };
  },
});
