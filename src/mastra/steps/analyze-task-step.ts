import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { executeTrackedStep } from './step-context.js';

export const analyzeTaskInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const analyzeTaskOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
});

export const analyzeTaskStep = createStep({
  id: 'analyze-task-step',
  inputSchema: analyzeTaskInputSchema,
  outputSchema: analyzeTaskOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    await executeTrackedStep(task, 'analyze-task', async () => {
      task.status = 'ANALYZING';
      await defaultTaskStore.updateStatus(task.id, 'ANALYZING', {
        summary: `正在分析需求复杂度与风险：${task.requirement.title}`,
      }).catch(() => {});

      // 评估复杂度与风险
      const title = task.requirement.title.toLowerCase();
      const desc = (task.requirement.description || '').toLowerCase();
      const isHighRisk = title.includes('auth') || title.includes('security') || title.includes('delete') || title.includes('pay') || desc.includes('database');

      task.analysis = {
        type: 'feature',
        complexity: (title.length > 30 || desc.length > 100) ? 'medium' : 'low',
        risk: isHighRisk ? 'medium' : 'low',
        summary: `需求评估完成：复杂度=${task.analysis?.complexity || 'low'}，风险=${isHighRisk ? 'medium' : 'low'}`,
      };

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'task.analyzed',
        summary: `任务分析完成（复杂度：${task.analysis.complexity}，风险：${task.analysis.risk}）`,
        data: {
          complexity: task.analysis.complexity,
          risk: task.analysis.risk,
        },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        summary: task.analysis.summary || '任务分析完成',
        data: {
          complexity: task.analysis.complexity,
          risk: task.analysis.risk,
        },
      };
    });

    return { task, projectContext };
  },
});
