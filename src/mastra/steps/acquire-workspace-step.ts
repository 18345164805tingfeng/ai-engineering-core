import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultWorkspaceManager } from '../../workspace/workspace-manager.js';
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
      task.scheduling = {
        ...task.scheduling,
        status: 'WAITING_FOR_WORKSPACE',
        waitingReason: `正在申请项目 '${task.project.id}' 的工作区锁`,
      };

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'workspace.waiting',
        summary: `正在申请项目 '${task.project.id}' 的工作区互斥排他锁`,
        data: { projectId: task.project.id },
      }).catch(() => {});

      const workspace = await defaultWorkspaceManager.acquireWorkspace(
        { id: task.project.id, root: projectContext.projectRoot },
        task.id
      );

      task.workspace = workspace;
      task.scheduling = {
        ...task.scheduling,
        status: 'RUNNING',
        startedAt: task.scheduling?.startedAt || new Date().toISOString(),
        waitingReason: null,
      };

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'workspace.acquired',
        summary: `已成功获取项目工作区排他锁（根目录：${projectContext.projectRoot}）`,
        data: {
          workspaceId: task.workspace.id,
          mode: task.workspace.mode,
          root: task.workspace.root,
        },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: `工作区排他锁已就绪（模式：${task.workspace.mode}）`,
        data: { workspaceId: task.workspace.id },
      };
    });

    return { task, projectContext };
  },
});
