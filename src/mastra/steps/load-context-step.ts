import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultProjectResolver } from '../../project/project-resolver.js';
import { ContextLoader } from '../../project/context-loader.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const loadContextInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema.optional(),
});

export const loadContextOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const loadContextStep = createStep({
  id: 'load-context-step',
  inputSchema: loadContextInputSchema,
  outputSchema: loadContextOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    let projectContext = inputData.projectContext;

    const outcome = await executeTrackedStep(task, 'load-context', async () => {
      task.status = 'LOADING_CONTEXT';
      await defaultTaskStore.updateStatus(task.id, 'LOADING_CONTEXT', {
        summary: `正在加载工程上下文：'${task.project.id}'`,
      }).catch(() => {});

      if (!projectContext || !projectContext.projectRoot) {
        defaultProjectResolver.loadConfig();
        const resolved = defaultProjectResolver.resolveProject(task.project.id);
        projectContext = ContextLoader.loadContext(resolved);
      }

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'project.context.loaded',
        summary: `成功加载工程上下文：${projectContext.projectId}`,
        data: {
          projectId: projectContext.projectId,
          projectRoot: projectContext.projectRoot,
        },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: `已加载工程 '${projectContext.projectId}' 上下文（根目录：${projectContext.projectRoot}）`,
        data: {
          projectId: projectContext.projectId,
          projectRoot: projectContext.projectRoot,
        },
      };
    });

    return {
      task,
      projectContext: projectContext!,
    };
  },
});
