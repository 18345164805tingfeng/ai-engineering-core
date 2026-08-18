import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const releaseWorkspaceInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  finalStatus: z.string(),
});

export const releaseWorkspaceOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  released: z.boolean(),
});

export const releaseWorkspaceStep = createStep({
  id: 'release-workspace-step',
  inputSchema: releaseWorkspaceInputSchema,
  outputSchema: releaseWorkspaceOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    await executeTrackedStep(task, 'release-workspace', async () => {
      const workspaceId = task.workspace?.id || `ws-${task.project.id}-${task.id}`;

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'workspace.released',
        summary: `工作区锁已安全释放（${workspaceId}）`,
        data: { workspaceId },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: `工作区资源已释放`,
        data: { workspaceId },
      };
    });

    return { task, projectContext, released: true };
  },
});
