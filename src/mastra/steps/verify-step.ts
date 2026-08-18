import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { runTestTool, ProcessResult } from '../../tools/index.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { VerificationClassifier, ClassifiedVerificationResult } from '../../workflow/verification/verification-classifier.js';
import { executeTrackedStep } from './step-context.js';

export const verifyInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  success: z.boolean(),
});

export const verifyOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  verificationResult: z.custom<ProcessResult>(),
  classifiedResult: z.custom<ClassifiedVerificationResult>().optional(),
});

export const verifyStep = createStep({
  id: 'verify-step',
  inputSchema: verifyInputSchema,
  outputSchema: verifyOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;

    let verificationResult: ProcessResult;
    let classified: ClassifiedVerificationResult;

    await executeTrackedStep(task, 'verify', async () => {
      task.status = 'VERIFYING';
      await defaultTaskStore.updateStatus(task.id, 'VERIFYING', {
        summary: `正在调用真实工具执行项目测试：${task.requirement.title}`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'verification.started',
        summary: `真实工具测试开始（轮次：${task.execution.round}）`,
        data: { round: task.execution.round },
      }).catch(() => {});

      try {
        verificationResult = await runTestTool('developer', projectContext);
      } catch (err) {
        verificationResult = {
          command: 'test',
          exitCode: 1,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          durationMs: 0,
          success: false,
        };
      }

      classified = VerificationClassifier.classify(verificationResult);

      const testArtifact = await defaultArtifactStore.createArtifact({
        taskId: task.id,
        type: 'test_log',
        data: {
          command: verificationResult.command,
          exitCode: verificationResult.exitCode,
          stdout: verificationResult.stdout,
          stderr: verificationResult.stderr,
          durationMs: verificationResult.durationMs,
          classification: classified,
        },
      });

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'verification.completed',
        summary: `测试执行完毕：[${classified.outcome}]（ExitCode: ${verificationResult.exitCode}，原因: ${classified.reason}）`,
        artifactId: testArtifact.id,
        data: {
          outcome: classified.outcome,
          canAutoFix: classified.canAutoFixByDeveloper,
          exitCode: verificationResult.exitCode,
          durationMs: verificationResult.durationMs,
        },
      }).catch(() => {});

      return {
        status: classified.outcome === 'PASSED' ? ('COMPLETED' as const) : ('FAILED' as const),
        summary: `测试结论：${classified.outcome}（${classified.reason}）`,
        artifactIds: [testArtifact.id],
        data: {
          outcome: classified.outcome,
          canAutoFix: classified.canAutoFixByDeveloper,
          exitCode: verificationResult.exitCode,
        },
      };
    });

    return {
      task,
      projectContext,
      verificationResult: verificationResult!,
      classifiedResult: classified!,
    };
  },
});
