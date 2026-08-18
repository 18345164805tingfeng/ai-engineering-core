import { InternalTask } from '../../task/schema/task.schema.js';
import { ReviewResult } from '../../task/schema/review-issue.schema.js';
import { ClassifiedVerificationResult } from './verification-classifier.js';

export interface CompletionGateEvaluation {
  canComplete: boolean;
  finalStatus: 'DONE' | 'BLOCKED' | 'FAILED';
  reasons: string[];
  blockingIssuesCount: number;
}

export class CompletionGate {
  /**
   * 严格评估 Task 是否满足终态 DONE 的完成门禁条件
   */
  static evaluate(params: {
    task: InternalTask;
    classifiedVerification?: ClassifiedVerificationResult;
    reviewResult?: ReviewResult;
    allowExemption?: boolean;
    exemptionReason?: string;
  }): CompletionGateEvaluation {
    const { task, classifiedVerification, reviewResult, allowExemption, exemptionReason } = params;
    const reasons: string[] = [];

    // 1. 人工豁免检查
    if (allowExemption) {
      return {
        canComplete: true,
        finalStatus: 'DONE',
        reasons: [`任务已获得人工明确豁免：${exemptionReason || '人工管理员授权完成'}`],
        blockingIssuesCount: 0,
      };
    }

    // 2. 真实测试工具结果判定 (最高证据等级)
    if (classifiedVerification) {
      if (classifiedVerification.outcome === 'BLOCKED_SANDBOX') {
        return {
          canComplete: false,
          finalStatus: 'BLOCKED',
          reasons: ['安全沙箱阻断：测试环境被安全守卫拦截，严禁标记为完成。'],
          blockingIssuesCount: 1,
        };
      }

      if (classifiedVerification.outcome === 'FAILED_ENVIRONMENT') {
        return {
          canComplete: false,
          finalStatus: 'BLOCKED',
          reasons: ['环境依赖缺失：测试环境不可用，无法证明代码正确性。'],
          blockingIssuesCount: 1,
        };
      }

      if (classifiedVerification.outcome === 'BLOCKED_PERMISSION') {
        return {
          canComplete: false,
          finalStatus: 'BLOCKED',
          reasons: ['系统权限受限：缺少执行测试所需的必要系统权限。'],
          blockingIssuesCount: 1,
        };
      }

      if (classifiedVerification.outcome === 'TIMEOUT') {
        return {
          canComplete: false,
          finalStatus: 'BLOCKED',
          reasons: ['测试执行超时：无法在规定时间内完成回归测试验证。'],
          blockingIssuesCount: 1,
        };
      }

      if (classifiedVerification.outcome === 'FAILED_CODE') {
        return {
          canComplete: false,
          finalStatus: 'FAILED',
          reasons: ['真实工具测试失败：单元测试或断言未通过。'],
          blockingIssuesCount: 1,
        };
      }
    }

    // 3. Reviewer 评审结论判定
    if (reviewResult) {
      if (reviewResult.result !== 'PASS') {
        const issues = reviewResult.issues || [];
        const criticalOrHighCount = issues.filter(
          (i) => i.severity === 'critical' || i.severity === 'high'
        ).length;

        return {
          canComplete: false,
          finalStatus: 'FAILED',
          reasons: [
            `代码评审未通过（结论：${reviewResult.result}，存在 ${criticalOrHighCount} 个阻断性 Critical/High 问题）。`,
          ],
          blockingIssuesCount: issues.length,
        };
      }
    }

    // 4. 全部门禁通过
    return {
      canComplete: true,
      finalStatus: 'DONE',
      reasons: ['开发已完成、真实工具测试通过、独立代码评审通过且无阻断性问题。'],
      blockingIssuesCount: 0,
    };
  }
}
