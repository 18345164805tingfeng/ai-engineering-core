import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { TaskSchema, InternalTask } from '../../task/schema/task.schema.js';
import { ProjectContextSchema, ProjectContext } from '../../project/schema/project.schema.js';
import { ReviewResult, ReviewResultSchema } from '../../task/schema/review-issue.schema.js';
import { defaultExecutorRouter } from '../../router/executor-router.js';
import { defaultTaskStore } from '../../task/store/task-store.js';
import { defaultArtifactStore } from '../../task/artifact/artifact-store.js';
import { ProcessResult } from '../../tools/index.js';
import { executeTrackedStep } from './step-context.js';

export const reviewInputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  verificationResult: z.custom<ProcessResult>(),
});

export const reviewOutputSchema = z.object({
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  reviewResult: ReviewResultSchema,
});

export const reviewStep = createStep({
  id: 'review-step',
  inputSchema: reviewInputSchema,
  outputSchema: reviewOutputSchema,
  execute: async ({ inputData }) => {
    const task = inputData.task as InternalTask;
    const projectContext = inputData.projectContext as ProjectContext;
    const verification = inputData.verificationResult;

    let finalReview: ReviewResult;

    await executeTrackedStep(task, 'review', async () => {
      task.status = 'REVIEWING';
      await defaultTaskStore.updateStatus(task.id, 'REVIEWING', {
        summary: `Reviewer 正在独立评审代码与测试结果（轮次：${task.review.round}）`,
      }).catch(() => {});

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'review.started',
        summary: `Reviewer 角色开始独立评审`,
        data: { round: task.review.round },
      }).catch(() => {});

      const reviewResp = await defaultExecutorRouter.executeRole({
        role: 'reviewer',
        task,
        projectContext,
        contextData: { verification },
      });

      if (reviewResp.structuredResult) {
        finalReview = reviewResp.structuredResult as ReviewResult;
      } else if (reviewResp.output) {
        try {
          const parsed = typeof reviewResp.output === 'string' ? JSON.parse(reviewResp.output) : reviewResp.output;
          finalReview = ReviewResultSchema.parse(parsed);
        } catch {
          finalReview = {
            round: task.review.round,
            result: verification?.success ? 'PASS' : 'FAIL',
            summary: '根据测试结果自动评估 Review 结论',
            issues: verification?.success ? [] : [
              {
                id: `ISSUE-${task.review.round}-001`,
                severity: 'high',
                category: 'test',
                file: 'tests',
                description: '单元测试执行失败',
                evidence: verification?.stderr || verification?.stdout || '',
                suggestion: '修复失败的单元测试用例',
              },
            ],
          };
        }
      } else {
        finalReview = {
          round: task.review.round,
          result: verification?.success ? 'PASS' : 'FAIL',
          summary: '基于测试执行的自动 Review 兜底判定',
          issues: [],
        };
      }

      task.review.result = finalReview.result;
      task.review.issues = finalReview.issues;

      const reviewArtifact = await defaultArtifactStore.createArtifact({
        taskId: task.id,
        type: 'review_detail',
        data: finalReview,
      });

      await defaultTaskStore.appendTimeline(task.id, {
        type: 'review.completed',
        summary: `Review 评审完成，结论：${finalReview.result}（发现 ${finalReview.issues?.length || 0} 个 Issue）`,
        artifactId: reviewArtifact.id,
        data: {
          round: task.review.round,
          result: finalReview.result,
          issuesCount: finalReview.issues?.length || 0,
        },
      }).catch(() => {});

      return {
        status: finalReview.result === 'PASS' ? ('COMPLETED' as const) : ('FAILED' as const),
        executor: reviewResp.executorId,
        summary: `Review 结论：${finalReview.result}，发现 ${finalReview.issues?.length || 0} 个问题`,
        artifactIds: [reviewArtifact.id],
        data: { result: finalReview.result, issuesCount: finalReview.issues?.length || 0 },
      };
    });

    return { task, projectContext, reviewResult: finalReview! };
  },
});
