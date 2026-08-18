import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const acquireWorkspaceInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const acquireWorkspaceOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const acquireWorkspaceStep = createStep({
  id: 'acquire-workspace-step',
  inputSchema: acquireWorkspaceInputSchema,
  outputSchema: acquireWorkspaceOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    await executeTrackedStep(task, 'acquire-workspace', async () => {
      task.workspace = {
        id: `ws-${task.project.id}-${task.id}`,
        mode: 'shared-lock',
        root: projectContext.projectRoot,
        branch: projectContext.git?.branch || 'main',
        baseBranch: 'main',
      };

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'workspace.acquired',
        summary: `已成功获取工作区锁（根目录：${projectContext.projectRoot}）`,
        data: {
          workspaceId: task.workspace.id,
          mode: task.workspace.mode,
          root: task.workspace.root,
        },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: `工作区锁已就绪（模式：${task.workspace.mode}）`,
        data: { workspaceId: task.workspace.id },
      };
    });

    return { task, projectContext };
  },
});
