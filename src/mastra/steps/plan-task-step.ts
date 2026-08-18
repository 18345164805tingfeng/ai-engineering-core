import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultExecutorRouter } from '../../router/executor-router.js';
import { runPlannerRole } from '../agents/planner.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { executeTrackedStep } from './step-context.js';

export const planTaskInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const planTaskOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const planTaskStep = createStep({
  id: 'plan-task-step',
  inputSchema: planTaskInputSchema,
  outputSchema: planTaskOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    await executeTrackedStep(task, 'plan-task', async () => {
      task.status = 'PLANNING';
      await defaultTaskStore.updateStatus(task.id, 'PLANNING', {
        summary: `正在制定实施方案：${task.requirement.title}`,
      }).catch(() => {});

      try {
        const plan = await runPlannerRole(defaultExecutorRouter, task, projectContext);
        if (plan) {
          task.plan = plan;

          const planArtifact = await defaultArtifactStore.createArtifact({
            taskId: task.id,
            type: 'plan_detail',
            data: plan,
          });

          await defaultTaskStore.appendTimeline(task.id, {
            type: 'plan.completed',
            summary: `实施方案规划完成（共 ${plan.steps?.length || 0} 个步骤）`,
            artifactId: planArtifact.id,
            data: { stepCount: plan.steps?.length || 0, summary: plan.summary },
          }).catch(() => {});

          return {
            status: 'COMPLETED' as const,
            summary: plan.summary || `规划了 ${plan.steps?.length || 0} 个原子步骤`,
            artifactIds: [planArtifact.id],
            data: { stepsCount: plan.steps?.length || 0 },
          };
        }
      } catch {
        task.plan = {
          summary: `实施方案：${task.requirement.title}`,
          steps: [{ id: 'STEP-1', title: `开发 ${task.requirement.title}` }],
        };
      }

      return {
        status: 'COMPLETED' as const,
        summary: `基础规划完成：${task.plan?.summary}`,
      };
    });

    return { task, projectContext };
  },
});
