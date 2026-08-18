import { describe, it, expect, beforeEach } from 'vitest';
import { executeSoftwareDevelopmentLoop } from '../src/mastra/workflows/software-development.js';
import { Task } from '../src/task/schema/task.schema.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { defaultTaskStore, InMemoryTaskStore } from '../src/task/store/task-store.js';
import { defaultWorkflowRunManager, WorkflowRunManager } from '../src/workflow/run/workflow-run-manager.js';
import { defaultWorkspaceManager, WorkspaceManager } from '../src/workspace/workspace-manager.js';
import { defaultProjectLockManager, ProjectLockManager } from '../src/workspace/project-lock-manager.js';
import { defaultExecutorConcurrencyManager } from '../src/scheduler/executor-concurrency-manager.js';
import { ExecutorRouter } from '../src/router/executor-router.js';
import { ExecutorRegistry } from '../src/executors/executor-registry.js';
import { MockAgentExecutor } from '../src/executors/mock/mock-executor.js';
import { VerificationClassifier } from '../src/workflow/verification/verification-classifier.js';
import { CompletionGate } from '../src/workflow/verification/completion-gate.js';
import { TaskGateway } from '../src/gateway/task-gateway.js';

describe('Phase H: Full E2E Workflow & Concurrency 12-Scenario Verification', () => {
  let mockExecutor: MockAgentExecutor;
  let customRouter: ExecutorRouter;
  let customStore: InMemoryTaskStore;
  let gateway: TaskGateway;
  let registry: ExecutorRegistry;

  beforeEach(() => {
    mockExecutor = new MockAgentExecutor('mock-dev');
    registry = new ExecutorRegistry();
    registry.registerExecutor(mockExecutor);
    customRouter = new ExecutorRouter({ registry });
    customRouter.setRolesConfig({
      roles: {
        developer: { primary: 'mock-dev', fallback: [] },
        reviewer: { primary: 'mock-dev', fallback: [] },
        planner: { primary: 'mock-dev', fallback: [] },
        tester: { primary: 'mock-dev', fallback: [] },
        architect: { primary: 'mock-dev', fallback: [] },
        router: { primary: 'mock-dev', fallback: [] },
      },
    });

    customStore = new InMemoryTaskStore();
    gateway = new TaskGateway(customStore);
    defaultProjectLockManager.clear();
    defaultWorkspaceManager.clear();
    defaultWorkflowRunManager.clear();
  });

  const createTestTask = (id: string, projectId: string, title: string): Task => {
    const now = new Date().toISOString();
    return {
      id,
      source: { type: 'manual' },
      project: { id: projectId, root: process.cwd() },
      requirement: { title, description: 'Test requirement' },
      priority: 'normal',
      mode: 'auto',
      status: 'CREATED',
      analysis: { type: null, complexity: null, risk: null },
      plan: null,
      execution: { round: 0, changes: [] },
      verification: { results: [] },
      review: { round: 0, result: null, issues: [] },
      arbitration: null,
      timeline: [],
      workflow: { workflowId: 'software-development', runId: `RUN-${id}`, currentStep: null },
      steps: [],
      workspace: { id: null, mode: 'shared-lock', root: null, branch: null, baseBranch: null },
      scheduling: { status: 'READY', queuedAt: null, startedAt: null, waitingReason: null },
      createdAt: now,
      updatedAt: now,
    };
  };

  // 场景 1: 单任务一次成功
  it('Scenario 1: Single task success on round 1', async () => {
    const task = createTestTask('TASK-E2E-1', 'demo', 'Add user login');
    const projectContext: ProjectContext = { projectId: 'demo', projectRoot: process.cwd() };

    mockExecutor.setOptions({
      responseHandler: async (req) => {
        if (req.role === 'reviewer') {
          return {
            output: 'LGTM',
            structuredResult: { round: 1, result: 'PASS', summary: 'All clean', issues: [] },
          };
        }
        return { output: 'console.log("logged in");' };
      },
    });

    const result = await executeSoftwareDevelopmentLoop(task, projectContext, {
      executorRouter: customRouter,
      maxRounds: 3,
      testRunner: async () => ({
        command: 'npm test',
        exitCode: 0,
        stdout: 'PASS',
        stderr: '',
        durationMs: 100,
        success: true,
      }),
    });

    expect(result.status).toBe('DONE');
    expect(result.rounds).toBe(1);
    expect(result.finalReview?.result).toBe('PASS');
  });

  // 场景 2: Review FAIL -> Fix -> Verify -> Review PASS
  it('Scenario 2: Review FAIL -> Fix -> Verify -> Review PASS loop', async () => {
    const task = createTestTask('TASK-E2E-2', 'demo', 'Fix data leak');
    const projectContext: ProjectContext = { projectId: 'demo', projectRoot: process.cwd() };

    let reviewCalls = 0;
    mockExecutor.setOptions({
      responseHandler: async (req) => {
        if (req.role === 'reviewer') {
          reviewCalls++;
          if (reviewCalls === 1) {
            return {
              output: 'Found issue',
              structuredResult: {
                round: 1,
                result: 'FAIL',
                summary: 'Token leak detected',
                issues: [
                  {
                    id: 'ISSUE-1',
                    severity: 'high',
                    category: 'security',
                    file: 'auth.ts',
                    description: 'Sensitive token exposed in log',
                  },
                ],
              },
            };
          }
          return {
            output: 'All clean',
            structuredResult: { round: 2, result: 'PASS', summary: 'Fixed', issues: [] },
          };
        }
        return { output: 'Developer modified code' };
      },
    });

    const result = await executeSoftwareDevelopmentLoop(task, projectContext, {
      executorRouter: customRouter,
      maxRounds: 3,
      testRunner: async () => ({
        command: 'npm test',
        exitCode: 0,
        stdout: 'PASS',
        stderr: '',
        durationMs: 50,
        success: true,
      }),
    });

    expect(result.status).toBe('DONE');
    expect(result.rounds).toBe(2);
    expect(reviewCalls).toBe(2);
  });

  // 场景 3: Verify FAILED_CODE -> Fix
  it('Scenario 3: Verify FAILED_CODE -> Fix in subsequent round', async () => {
    const testResult = VerificationClassifier.classify({
      command: 'vitest run',
      exitCode: 1,
      stdout: 'FAIL tests/login.test.ts',
      stderr: 'AssertionError: expected false to be true',
      durationMs: 300,
      success: false,
    });

    expect(testResult.outcome).toBe('FAILED_CODE');
    expect(testResult.canAutoFixByDeveloper).toBe(true);
  });

  // 场景 4: BLOCKED_SANDBOX 不允许 DONE
  it('Scenario 4: BLOCKED_SANDBOX strictly prevents task from reaching DONE', async () => {
    const task = createTestTask('TASK-E2E-4', 'demo', 'Unsafe format test');
    const classified = VerificationClassifier.classify({
      command: 'npm test',
      exitCode: 1,
      stdout: '',
      stderr: 'ProjectPathGuardError: 目标路径试图跳出项目根目录',
      durationMs: 10,
      success: false,
    });

    const evalRes = CompletionGate.evaluate({
      task,
      classifiedVerification: classified,
      reviewResult: { round: 1, result: 'PASS', issues: [] },
    });

    expect(evalRes.canComplete).toBe(false);
    expect(evalRes.finalStatus).toBe('BLOCKED');
  });

  // 场景 5: 两个不同项目 Task 同时运行
  it('Scenario 5: Two tasks on different projects can run concurrently', async () => {
    const lockMgr = new ProjectLockManager();
    const wsMgr = new WorkspaceManager(lockMgr);

    const ws1 = await wsMgr.acquireWorkspace({ id: 'project-1', root: '/p1' }, 'TASK-1');
    const ws2 = await wsMgr.acquireWorkspace({ id: 'project-2', root: '/p2' }, 'TASK-2');

    expect(ws1.id).toBe('ws-project-1-TASK-1');
    expect(ws2.id).toBe('ws-project-2-TASK-2');
    expect(lockMgr.isLocked('project-1')).toBe(true);
    expect(lockMgr.isLocked('project-2')).toBe(true);
  });

  // 场景 6: 同项目两个 Task：一个运行，一个 WAITING_FOR_WORKSPACE
  it('Scenario 6: Same project tasks enforce lock: Task 2 waits for Task 1', async () => {
    const lockMgr = new ProjectLockManager();
    const wsMgr = new WorkspaceManager(lockMgr);

    await wsMgr.acquireWorkspace({ id: 'demo', root: '/demo' }, 'TASK-1');

    let task2Ready = false;
    const task2Promise = wsMgr.acquireWorkspace({ id: 'demo', root: '/demo' }, 'TASK-2').then((ws) => {
      task2Ready = true;
      return ws;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(task2Ready).toBe(false);
    expect(lockMgr.getCurrentOwner('demo')).toBe('TASK-1');
    expect(lockMgr.getWaitingQueue('demo')).toContain('TASK-2');

    await wsMgr.releaseWorkspace('demo', 'TASK-1');
    await task2Promise;
    expect(task2Ready).toBe(true);
    expect(lockMgr.getCurrentOwner('demo')).toBe('TASK-2');
  });

  // 场景 7: Executor maxConcurrency 生效
  it('Scenario 7: Executor maxConcurrency limits concurrent access slots', async () => {
    defaultExecutorConcurrencyManager.setLimit('ollama', 1);

    const slot1 = await defaultExecutorConcurrencyManager.acquireSlot('ollama', 'TASK-A');
    expect(slot1).toBe(true);

    let slot2Acquired = false;
    const slot2Promise = defaultExecutorConcurrencyManager.acquireSlot('ollama', 'TASK-B').then((res) => {
      slot2Acquired = true;
      return res;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(slot2Acquired).toBe(false);

    defaultExecutorConcurrencyManager.releaseSlot('ollama', 'TASK-A');
    await slot2Promise;
    expect(slot2Acquired).toBe(true);
  });

  // 场景 8: Cancel 一个 Run 不影响另外一个 Run
  it('Scenario 8: Cancelling Run 1 does not cancel Run 2', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 1 to cancel' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 2 to stay active' },
    });

    await gateway.cancelTask(task1.id, 'User cancel');

    const run1 = defaultWorkflowRunManager.getRunByTaskId(task1.id);
    const run2 = defaultWorkflowRunManager.getRunByTaskId(task2.id);

    expect(run1?.status).toBe('CANCELLED');
    expect(run2?.status).toBe('PENDING');
    expect(run2?.abortController.signal.aborted).toBe(false);
  });

  // 场景 9: Review maxRounds -> Arbitrate
  it('Scenario 9: Reaching max review rounds triggers Architect Arbitration', async () => {
    const task = createTestTask('TASK-E2E-9', 'demo', 'Controversial refactoring');
    const projectContext: ProjectContext = { projectId: 'demo', projectRoot: process.cwd() };

    mockExecutor.setOptions({
      responseHandler: async (req) => {
        if (req.role === 'reviewer') {
          return {
            output: 'FAIL',
            structuredResult: {
              round: 1,
              result: 'FAIL',
              summary: 'Cannot reach agreement',
              issues: [{ id: 'ISS-1', severity: 'high', category: 'architecture', file: 'a.ts', description: 'Pattern disagreement' }],
            },
          };
        }
        if (req.role === 'architect') {
          return {
            output: 'PROCEED',
            structuredResult: {
              decision: 'PROCEED',
              feedback: 'Architect approves exception',
              arbitratedAt: new Date().toISOString(),
            },
          };
        }
        return { output: 'Developer done' };
      },
    });

    const result = await executeSoftwareDevelopmentLoop(task, projectContext, {
      executorRouter: customRouter,
      maxRounds: 2,
      testRunner: async () => ({
        command: 'npm test',
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 10,
        success: true,
      }),
    });

    expect(result.needArbitration).toBe(true);
    expect(result.arbitration?.decision).toBe('PROCEED');
    expect(result.status).toBe('DONE');
  });

  // 场景 10: Agent 返回 success，真实 Test 失败，Task 不得 DONE
  it('Scenario 10: Agent success + Real Test Failure strictly prevents DONE', async () => {
    const task = createTestTask('TASK-E2E-10', 'demo', 'Fake success test');
    const classified = VerificationClassifier.classify({
      command: 'vitest run',
      exitCode: 1,
      stdout: 'Tests failed: 2 failed',
      stderr: 'Error: database table not created',
      durationMs: 50,
      success: false,
    });

    // Even if Reviewer is mocked to say PASS
    const evaluation = CompletionGate.evaluate({
      task,
      classifiedVerification: classified,
      reviewResult: { round: 1, result: 'PASS', issues: [] },
    });

    expect(evaluation.canComplete).toBe(false);
    expect(evaluation.finalStatus).toBe('FAILED');
  });

  // 场景 11: Run A Suspend 不影响 Run B
  it('Scenario 11: Run A status change to WAITING_FOR_APPROVAL does not affect Run B', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 1 requiring approval' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 2 running normally' },
    });

    await gateway.updateTaskStatus(task1.id, 'LOADING_CONTEXT');
    await gateway.updateTaskStatus(task1.id, 'ANALYZING');
    await gateway.updateTaskStatus(task1.id, 'WAITING_FOR_APPROVAL', {
      summary: 'Task 1 waiting for human approval',
    });

    const refreshed1 = await gateway.getTask(task1.id);
    const refreshed2 = await gateway.getTask(task2.id);

    expect(refreshed1?.status).toBe('WAITING_FOR_APPROVAL');
    expect(refreshed2?.status).toBe('CREATED');
  });

  // 场景 12: Run A Timeline 不得写入 Run B
  it('Scenario 12: Run A timeline events are strictly isolated from Run B', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task A' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task B' },
    });

    await customStore.appendTimeline(task1.id, {
      type: 'custom.audit.event',
      summary: 'Private event for Task A',
    });

    const t1 = await customStore.getTask(task1.id);
    const t2 = await customStore.getTask(task2.id);

    expect(t1?.timeline.some((e) => e.summary === 'Private event for Task A')).toBe(true);
    expect(t2?.timeline.some((e) => e.summary === 'Private event for Task A')).toBe(false);
  });
});
