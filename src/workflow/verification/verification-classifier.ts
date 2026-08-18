import { z } from 'zod';
import { ProcessResult } from '../../tools/index.js';

export const VerificationOutcomeSchema = z.enum([
  'PASSED',
  'FAILED_CODE',
  'FAILED_ENVIRONMENT',
  'BLOCKED_SANDBOX',
  'BLOCKED_PERMISSION',
  'TIMEOUT',
  'CANCELLED',
  'INDETERMINATE',
]);

export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

export interface ClassifiedVerificationResult {
  outcome: VerificationOutcome;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  reason: string;
  canAutoFixByDeveloper: boolean;
}

export class VerificationClassifier {
  /**
   * 对真实的工具执行结果进行智能分类判定
   */
  static classify(result: ProcessResult, options?: { timeoutMs?: number }): ClassifiedVerificationResult {
    const exitCode = result.exitCode ?? 0;
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const output = `${stdout}\n${stderr}`;
    const durationMs = result.durationMs || 0;
    const timeoutMs = options?.timeoutMs || 120000;

    // 1. 成功判定
    if (result.success && exitCode === 0) {
      return {
        outcome: 'PASSED',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: '测试套件全部执行通过',
        canAutoFixByDeveloper: false,
      };
    }

    // 2. 超时判定
    if (durationMs >= timeoutMs || /timed?\s*out|ETIMEDOUT/i.test(output)) {
      return {
        outcome: 'TIMEOUT',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: `测试命令执行超时（耗时 ${durationMs}ms，超时阈值 ${timeoutMs}ms）`,
        canAutoFixByDeveloper: false,
      };
    }

    // 3. 沙箱与安全拦截判定
    if (
      /ProjectPathGuard|ProcessCommandGuard|sandbox\s+blocked|seccomp|operation\s+not\s+permitted\s+in\s+sandbox/i.test(
        output
      ) ||
      /安全拦截|高危破坏性系统命令|路径穿越/i.test(output)
    ) {
      return {
        outcome: 'BLOCKED_SANDBOX',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: '测试执行被安全沙箱或命令安全守卫拦截',
        canAutoFixByDeveloper: false,
      };
    }

    // 4. 权限受阻判定
    if (/EACCES|permission\s+denied|Unauthorized|Access\s+is\s+denied/i.test(output)) {
      return {
        outcome: 'BLOCKED_PERMISSION',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: '系统文件或进程权限不足',
        canAutoFixByDeveloper: false,
      };
    }

    // 5. 运行环境与依赖缺失判定
    if (
      /ENOENT|command\s+not\s+found|MODULE_NOT_FOUND|Cannot\s+find\s+module|failed\s+to\s+load\s+config|ECONNREFUSED|ENOTFOUND|Python\s+was\s+not\s+found|npm\s+ERR!\s+missing/i.test(
        output
      )
    ) {
      return {
        outcome: 'FAILED_ENVIRONMENT',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: '执行环境、运行依赖或基础命令缺失',
        canAutoFixByDeveloper: false,
      };
    }

    // 6. 业务代码断言与逻辑测试失败
    if (
      /AssertionError|AssertionError|test\s+failed|tests\s+failed|FAILED\s+\(failures=\d+\)|FAIL\s+|expected\s+.*\s+to\s+(equal|be|match)|SyntaxError|TypeError|ReferenceError/i.test(
        output
      )
    ) {
      return {
        outcome: 'FAILED_CODE',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: '单元测试用例断言失败或业务代码逻辑异常',
        canAutoFixByDeveloper: true,
      };
    }

    // 7. 兜底判定
    if (exitCode !== 0) {
      return {
        outcome: 'FAILED_CODE',
        command: result.command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        reason: `测试进程异常退出（ExitCode: ${exitCode}）`,
        canAutoFixByDeveloper: true,
      };
    }

    return {
      outcome: 'INDETERMINATE',
      command: result.command,
      exitCode,
      stdout,
      stderr,
      durationMs,
      reason: '无法明确归类的测试结果',
      canAutoFixByDeveloper: false,
    };
  }
}
