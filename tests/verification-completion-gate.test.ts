import { describe, it, expect } from 'vitest';
import { VerificationClassifier } from '../src/workflow/verification/verification-classifier.js';
import { CompletionGate } from '../src/workflow/verification/completion-gate.js';
import { Task } from '../src/task/schema/task.schema.js';

describe('Phase D: Verification Classifier & Completion Gate', () => {
  const createMockTask = (): Task => {
    const now = new Date().toISOString();
    return {
      id: 'TASK-GATE-001',
      source: { type: 'manual' },
      project: { id: 'demo' },
      requirement: { title: 'Test verification gate' },
      priority: 'normal',
      mode: 'auto',
      status: 'REVIEWING',
      analysis: { type: null, complexity: null, risk: null },
      plan: null,
      execution: { round: 1, changes: [] },
      verification: { results: [] },
      review: { round: 1, result: null, issues: [] },
      arbitration: null,
      timeline: [],
      workflow: { workflowId: 'software-development', runId: 'RUN-001', currentStep: 'verify' },
      steps: [],
      workspace: { id: null, mode: 'shared-lock', root: null, branch: null, baseBranch: null },
      scheduling: { status: 'RUNNING', queuedAt: null, startedAt: null, waitingReason: null },
      createdAt: now,
      updatedAt: now,
    };
  };

  describe('VerificationClassifier', () => {
    it('should classify exitCode 0 as PASSED', () => {
      const result = VerificationClassifier.classify({
        command: 'vitest run',
        exitCode: 0,
        stdout: '✓ 10 passed',
        stderr: '',
        durationMs: 1500,
        success: true,
      });

      expect(result.outcome).toBe('PASSED');
      expect(result.canAutoFixByDeveloper).toBe(false);
    });

    it('should classify sandbox and guard blocks as BLOCKED_SANDBOX', () => {
      const result = VerificationClassifier.classify({
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'ProjectPathGuardError: 目标路径试图跳出项目根目录',
        durationMs: 200,
        success: false,
      });

      expect(result.outcome).toBe('BLOCKED_SANDBOX');
      expect(result.canAutoFixByDeveloper).toBe(false);
    });

    it('should classify missing commands or modules as FAILED_ENVIRONMENT', () => {
      const result = VerificationClassifier.classify({
        command: 'pytest',
        exitCode: 127,
        stdout: '',
        stderr: 'bash: pytest: command not found (ENOENT)',
        durationMs: 100,
        success: false,
      });

      expect(result.outcome).toBe('FAILED_ENVIRONMENT');
      expect(result.canAutoFixByDeveloper).toBe(false);
    });

    it('should classify permission errors as BLOCKED_PERMISSION', () => {
      const result = VerificationClassifier.classify({
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'Error: EACCES: permission denied, open /var/run/test.sock',
        durationMs: 50,
        success: false,
      });

      expect(result.outcome).toBe('BLOCKED_PERMISSION');
      expect(result.canAutoFixByDeveloper).toBe(false);
    });

    it('should classify timeouts as TIMEOUT', () => {
      const result = VerificationClassifier.classify(
        {
          command: 'npm test',
          exitCode: 1,
          stdout: '',
          stderr: 'Operation timed out after 5000ms',
          durationMs: 6000,
          success: false,
        },
        { timeoutMs: 5000 }
      );

      expect(result.outcome).toBe('TIMEOUT');
      expect(result.canAutoFixByDeveloper).toBe(false);
    });

    it('should classify code assertion errors as FAILED_CODE with canAutoFixByDeveloper = true', () => {
      const result = VerificationClassifier.classify({
        command: 'vitest run',
        exitCode: 1,
        stdout: 'FAIL tests/app.test.ts > should return 200',
        stderr: 'AssertionError: expected 404 to be 200',
        durationMs: 1200,
        success: false,
      });

      expect(result.outcome).toBe('FAILED_CODE');
      expect(result.canAutoFixByDeveloper).toBe(true);
    });
  });

  describe('CompletionGate', () => {
    it('should allow DONE when verification PASSED and review PASS with no blocking issues', () => {
      const task = createMockTask();
      const classified = VerificationClassifier.classify({
        command: 'vitest',
        exitCode: 0,
        stdout: 'All tests passed',
        stderr: '',
        success: true,
      });

      const evaluation = CompletionGate.evaluate({
        task,
        classifiedVerification: classified,
        reviewResult: { round: 1, result: 'PASS', issues: [] },
      });

      expect(evaluation.canComplete).toBe(true);
      expect(evaluation.finalStatus).toBe('DONE');
      expect(evaluation.blockingIssuesCount).toBe(0);
    });

    it('should block DONE and set BLOCKED when sandbox blocked', () => {
      const task = createMockTask();
      const classified = VerificationClassifier.classify({
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'ProcessCommandGuard: 高危破坏性系统命令已被禁止执行',
        success: false,
      });

      const evaluation = CompletionGate.evaluate({
        task,
        classifiedVerification: classified,
        reviewResult: { round: 1, result: 'PASS', issues: [] },
      });

      expect(evaluation.canComplete).toBe(false);
      expect(evaluation.finalStatus).toBe('BLOCKED');
    });

    it('should fail completion when review contains high severity issues', () => {
      const task = createMockTask();
      const evaluation = CompletionGate.evaluate({
        task,
        reviewResult: {
          round: 1,
          result: 'FAIL',
          issues: [
            {
              id: 'ISS-1',
              severity: 'high',
              category: 'correctness',
              file: 'src/index.ts',
              description: 'Null pointer exception on undefined user',
            },
          ],
        },
      });

      expect(evaluation.canComplete).toBe(false);
      expect(evaluation.finalStatus).toBe('FAILED');
      expect(evaluation.blockingIssuesCount).toBe(1);
    });

    it('should allow DONE if human exemption is explicitly granted', () => {
      const task = createMockTask();
      const classified = VerificationClassifier.classify({
        command: 'npm test',
        exitCode: 1,
        stdout: '',
        stderr: 'Environment missing',
        success: false,
      });

      const evaluation = CompletionGate.evaluate({
        task,
        classifiedVerification: classified,
        allowExemption: true,
        exemptionReason: 'Manual verification approved by Lead QA',
      });

      expect(evaluation.canComplete).toBe(true);
      expect(evaluation.finalStatus).toBe('DONE');
    });
  });
});
