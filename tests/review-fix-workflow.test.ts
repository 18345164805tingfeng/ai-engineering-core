import { describe, it, expect } from 'vitest';
import { executeSoftwareDevelopmentLoop } from '../src/mastra/workflows/software-development.js';
import { ExecutorRouter } from '../src/router/executor-router.js';
import { ExecutorRegistry } from '../src/executors/executor-registry.js';
import { MockAgentExecutor } from '../src/executors/mock/mock-executor.js';
import { AntigravityAgentExecutor } from '../src/executors/agent/antigravity-executor.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { InternalTask } from '../src/task/schema/task.schema.js';
import { ReviewResult } from '../src/task/schema/review-issue.schema.js';

describe('Software Development Workflow & Review Fix Loop', () => {
  const dummyTask: InternalTask = {
    id: 'TASK-3001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: process.cwd() },
    requirement: { title: 'User Soft Delete', description: 'Mark isDeleted flag on delete' },
    priority: 'normal',
    mode: 'auto',
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
      headCommit: '112233',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: { test: 'npm test' },
    loadedAt: new Date().toISOString(),
  };

  function setupRouter(reviewerResultFn: (round: number) => ReviewResult) {
    const registry = new ExecutorRegistry();

    // Register Mock Developer
    const mockDev = new MockAgentExecutor('mock-dev');
    registry.registerExecutor(mockDev);

    // Register Antigravity Reviewer with dynamic customRunner
    let currentRound = 0;
    const reviewerExecutor = new AntigravityAgentExecutor({
      id: 'antigravity-rev',
      agentRole: 'reviewer',
      customRunner: async (req) => {
        currentRound++;
        const result = reviewerResultFn(currentRound);
        return {
          output: JSON.stringify(result),
          structuredResult: result,
        };
      },
    });
    registry.registerExecutor(reviewerExecutor);

    const router = new ExecutorRouter({
      registry,
    });
    router.setRolesConfig({
      roles: {
        developer: { primary: 'mock-dev', fallback: [] },
        reviewer: { primary: 'antigravity-rev', fallback: [] },
        planner: { primary: 'mock-dev', fallback: [] },
        tester: { primary: 'mock-dev', fallback: [] },
        architect: { primary: 'mock-dev', fallback: [] },
        router: { primary: 'mock-dev', fallback: [] },
      },
    });

    return router;
  }

  it('should complete in 1 round when Reviewer passes on first check', async () => {
    const router = setupRouter(() => ({
      result: 'PASS',
      summary: 'LGTM',
      issues: [],
    }));

    const mockTestRunner = async () => ({
      command: 'npm test',
      exitCode: 0,
      stdout: 'All tests passed',
      stderr: '',
      durationMs: 50,
      success: true,
    });

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: mockTestRunner,
    });

    expect(res.status).toBe('DONE');
    expect(res.rounds).toBe(1);
    expect(res.needArbitration).toBe(false);
    expect(res.finalReview?.result).toBe('PASS');
  });

  it('should execute Fix Loop and pass in round 2 when round 1 fails', async () => {
    const router = setupRouter((round) => {
      if (round === 1) {
        return {
          result: 'FAIL',
          summary: 'Missing audit log',
          issues: [
            {
              id: 'ISSUE-1',
              severity: 'high',
              category: 'correctness',
              file: 'src/user.js',
              description: 'Soft delete must record timestamp',
              suggestion: 'Add deletedAt timestamp field',
            },
          ],
        };
      }
      return {
        result: 'PASS',
        summary: 'Fixed issue correctly',
        issues: [],
      };
    });

    const mockTestRunner = async () => ({
      command: 'npm test',
      exitCode: 0,
      stdout: 'Tests passed',
      stderr: '',
      durationMs: 40,
      success: true,
    });

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: mockTestRunner,
    });

    expect(res.status).toBe('DONE');
    expect(res.rounds).toBe(2);
    expect(res.needArbitration).toBe(false);
    expect(res.finalReview?.result).toBe('PASS');
  });

  it('should transition to NEED_ARBITRATION when maxRounds exceeded', async () => {
    const router = setupRouter(() => ({
      result: 'FAIL',
      summary: 'Persistent architectural flaw',
      issues: [
        {
          id: 'ISSUE-FAIL',
          severity: 'critical',
          category: 'architecture',
          file: 'src/core.js',
          description: 'Circular dependency introduced',
          suggestion: 'Refactor dependency graph',
        },
      ],
    }));

    const mockTestRunner = async () => ({
      command: 'npm test',
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 10,
      success: true,
    });

    const res = await executeSoftwareDevelopmentLoop(dummyTask, dummyContext, {
      executorRouter: router,
      maxRounds: 3,
      testRunner: mockTestRunner,
    });

    expect(res.status).toBe('NEED_ARBITRATION');
    expect(res.rounds).toBe(3);
    expect(res.needArbitration).toBe(true);
    expect(res.finalReview?.result).toBe('FAIL');
  });
});
