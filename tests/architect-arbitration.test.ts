import { describe, it, expect } from 'vitest';
import { executeSoftwareDevelopmentLoop } from '../src/mastra/workflows/software-development.js';
import { runPlannerRole } from '../src/mastra/agents/planner.js';
import { runArchitectRole } from '../src/mastra/agents/architect.js';
import { ExecutorRouter } from '../src/router/executor-router.js';
import { ExecutorRegistry } from '../src/executors/executor-registry.js';
import { MockAgentExecutor } from '../src/executors/mock/mock-executor.js';
import { AntigravityAgentExecutor } from '../src/executors/agent/antigravity-executor.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { InternalTask } from '../src/task/schema/task.schema.js';
import { ReviewResult } from '../src/task/schema/review-issue.schema.js';

describe('Planner, Architect & Arbitration (Phase 9)', () => {
  const dummyTask: InternalTask = {
    id: 'TASK-5001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: process.cwd() },
    requirement: { title: 'Complex Refactoring', description: 'Refactor user module' },
    priority: 'high',
    mode: 'strict',
    status: 'CREATED',
    analysis: {},
    execution: { round: 0, changes: [] },
    verification: { results: [] },
    review: { round: 0, result: null, issues: [] },
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const dummyContext: ProjectContext = {
    projectId: 'demo',
    projectName: 'Demo Project',
    projectRoot: process.cwd(),
    agentsDoc: null,
    readmeDoc: null,
    projectYaml: null,
    manifest: {
      type: 'node',
      name: 'demo',
      version: '1.0.0',
      dependencies: [],
      devDependencies: [],
      scripts: {},
    },
    git: {
      isGitRepo: true,
      branch: 'main',
      headCommit: '998877',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: { test: 'npm test' },
    loadedAt: new Date().toISOString(),
  };

  function setupRouter(
    reviewerFn: (round: number) => ReviewResult,
    architectDecision: 'PROCEED' | 'RETRY_DEVELOPER' | 'CANCEL' | 'MANUAL_INTERVENTION' = 'RETRY_DEVELOPER'
  ) {
    const registry = new ExecutorRegistry();

    const mockDev = new MockAgentExecutor('mock-dev');
    const mockPlanner = new MockAgentExecutor('mock-planner', {
      responseHandler: async () => ({
        output: JSON.stringify({
          summary: 'Detailed plan',
          steps: [{ id: 'STEP-1', title: 'Refactor service' }],
        }),
      }),
    });

    let currentReviewRound = 0;
    const reviewerExecutor = new AntigravityAgentExecutor({
      id: 'antigravity-rev',
      agentRole: 'reviewer',
      customRunner: async () => {
        currentReviewRound++;
        const result = reviewerFn(currentReviewRound);
        return {
          output: JSON.stringify(result),
          structuredResult: result,
        };
      },
    });

    const architectExecutor = new AntigravityAgentExecutor({
      id: 'antigravity-arch',
      agentRole: 'architect',
      customRunner: async () => ({
        output: JSON.stringify({
          decision: architectDecision,
          feedback: `Architect decision: ${architectDecision}`,
        }),
      }),
    });

    registry.registerExecutor(mockDev);
    registry.registerExecutor(mockPlanner);
    registry.registerExecutor(reviewerExecutor);
    registry.registerExecutor(architectExecutor);

    const router = new ExecutorRouter({ registry });
    router.setRolesConfig({
      roles: {
        developer: { primary: 'mock-dev', fallback: [] },
        reviewer: { primary: 'antigravity-rev', fallback: [] },
        planner: { primary: 'mock-planner', fallback: [] },
        architect: { primary: 'antigravity-arch', fallback: [] },
        tester: { primary: 'mock-dev', fallback: [] },
        router: { primary: 'mock-dev', fallback: [] },
      },
    });

    return router;
  }

  it('should run Planner Role and generate structured TaskPlan', async () => {
    const router = setupRouter(() => ({ round: 1, result: 'PASS', issues: [] }));
    const plan = await runPlannerRole(router, dummyTask, dummyContext);

    expect(plan).toBeDefined();
    expect(plan.summary).toContain('Detailed plan');
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].id).toBe('STEP-1');
  });

  it('should run Architect Role and generate structured TaskArbitration', async () => {
    const router = setupRouter(() => ({ round: 1, result: 'FAIL', issues: [] }), 'RETRY_DEVELOPER');
    const arbitration = await runArchitectRole(router, dummyTask, dummyContext, []);

    expect(arbitration.decision).toBe('RETRY_DEVELOPER');
    expect(arbitration.feedback).toContain('RETRY_DEVELOPER');
    expect(arbitration.arbitratedAt).toBeDefined();
  });

  it('should trigger Final Fix Round when Architect decides RETRY_DEVELOPER and succeed', async () => {
    // Rounds 1, 2, 3 fail. Architect says RETRY_DEVELOPER. Round 4 (Final Fix) passes.
    const router = setupRouter((round) => {
      if (round <= 3) {
        return {
          round,
          result: 'FAIL',
          summary: `Fail in round ${round}`,
          issues: [{ id: `ISSUE-${round}`, severity: 'high', category: 'correctness', file: 'a.js', description: 'err' }],
        };
      }
      return {
        round,
        result: 'PASS',
        summary: 'Final Fix Passed',
        issues: [],
      };
    }, 'RETRY_DEVELOPER');

    const mockTestRunner = async () => ({
      command: 'npm test',
      exitCode: 0,
      stdout: 'Tests passed',
      stderr: '',
      durationMs: 20,
      success: true,
    });

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: mockTestRunner,
    });

    expect(res.needArbitration).toBe(true);
    expect(res.arbitration?.decision).toBe('RETRY_DEVELOPER');
    expect(res.status).toBe('DONE');
    expect(res.finalReview?.result).toBe('PASS');
  });

  it('should transition to CANCELLED when Architect decides CANCEL', async () => {
    const router = setupRouter(() => ({ round: 1, result: 'FAIL', issues: [] }), 'CANCEL');

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: async () => ({ command: 'test', exitCode: 1, stdout: '', stderr: '', durationMs: 5, success: false }),
    });

    expect(res.needArbitration).toBe(true);
    expect(res.arbitration?.decision).toBe('CANCEL');
    expect(res.status).toBe('CANCELLED');
  });

  it('should transition to BLOCKED when Architect decides MANUAL_INTERVENTION', async () => {
    const router = setupRouter(() => ({ round: 1, result: 'FAIL', issues: [] }), 'MANUAL_INTERVENTION');

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: async () => ({ command: 'test', exitCode: 1, stdout: '', stderr: '', durationMs: 5, success: false }),
    });

    expect(res.needArbitration).toBe(true);
    expect(res.arbitration?.decision).toBe('MANUAL_INTERVENTION');
    expect(res.status).toBe('BLOCKED');
  });
});
