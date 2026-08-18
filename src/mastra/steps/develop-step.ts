import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { defaultExecutorRouter } from '../../router/executor-router.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { ProjectPathGuard } from '../../security/project-path-guard.js';
import { executeTrackedStep } from './step-context.js';

export const developInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  prompt: z.string().optional(),
});

export const developOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  success: z.boolean(),
});

export function applyModelFileChanges(output: string, projectRoot: string, taskRequirement: string): void {
  if (!output) return;
  const reqText = taskRequirement || '';
  let targetPath: string | null = null;
  const absMatch = reqText.match(/([a-zA-Z]:[\\/][^\s"'\n]+\.(?:json|py|md|yaml|txt))/i);
  if (absMatch) {
    targetPath = absMatch[1];
  } else {
    const fileMatch = reqText.match(/([\w_\u4e00-\u9fa5\.-]+\.(?:json|py|md|yaml|txt))/i);
    if (fileMatch) {
      const filename = fileMatch[1];
      const dirMatch = reqText.match(/([a-zA-Z]:[\\/][^\s"'\n]*[\\/])/i);
      if (dirMatch) {
        targetPath = path.join(dirMatch[1], filename);
      } else {
        targetPath = path.resolve(projectRoot, filename);
      }
    }
  }

  if (targetPath) {
    try {
      targetPath = ProjectPathGuard.validatePath(projectRoot, targetPath);
    } catch (guardErr) {
      console.warn(`[安全沙箱] 拦截不安全的文件写入 '${targetPath}':`, guardErr);
      return;
    }

    const jsonBlock = output.match(/```json\s*([\s\S]*?)\s*```/i) || output.match(/```\s*([\s\S]*?)\s*```/i);
    const fileContent = jsonBlock ? jsonBlock[1].trim() : (output.trim().startsWith('{') ? output.trim() : null);

    if (fileContent) {
      try {
        const dir = path.dirname(targetPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(targetPath, fileContent, 'utf-8');
      } catch (err) {
        console.warn(`[工作流] 写入文件 '${targetPath}' 失败:`, err);
      }
    }
  }
}

export const developStep = createStep({
  id: 'develop-step',
  inputSchema: developInputSchema,
  outputSchema: developOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    let success = true;

    await executeTrackedStep(task, 'develop', async () => {
      task.status = 'CODING';
      await defaultTaskStore.updateStatus(task.id, 'CODING', {
        summary: `Developer 正在编写代码：${task.requirement.title}`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'development.started',
        summary: `Developer 角色已开始代码编写`,
        data: { round: task.execution.round },
      }).catch(() => {});

      const prompt = inputData.prompt || `Develop feature: ${task.requirement.title}\nPlan: ${JSON.stringify(task.plan)}`;
      const devResp = await defaultExecutorRouter.executeRole({
        role: 'developer',
        task,
        projectContext,
        prompt,
      });

      if (!devResp.success) {
        success = false;
        return {
          status: 'FAILED' as const,
          executor: devResp.executorId,
          error: devResp.error || 'Developer initial coding failed',
          summary: `Developer 编写代码失败：${devResp.error}`,
        };
      }

      if (devResp.output) {
        const outputStr = typeof devResp.output === 'string' ? devResp.output : JSON.stringify(devResp.output);
        applyModelFileChanges(outputStr, projectContext.projectRoot, `${task.requirement.title}\n${task.requirement.description || ''}`);
      }

      const devArtifact = await defaultArtifactStore.createArtifact({
        taskId: task.id,
        type: 'executor_output',
        data: devResp.output || devResp.structuredResult,
      });

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'development.completed',
        summary: `Developer 代码编写完成`,
        artifactId: devArtifact.id,
        data: { round: task.execution.round },
      }).catch(() => {});

      return {
        status: 'COMPLETED' as const,
        executor: devResp.executorId,
        summary: 'Developer 编码阶段完成',
        artifactIds: [devArtifact.id],
      };
    });

    return { task, projectContext, success };
  },
});
