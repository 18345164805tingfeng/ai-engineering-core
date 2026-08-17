import { describe, it, expect } from 'vitest';
import { AntigravityAgentExecutor } from '../src/executors/agent/antigravity-executor.js';
import { ExecutionRequest } from '../src/executors/schema/executor.schema.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { InternalTask } from '../src/task/schema/task.schema.js';
import { ReviewResult } from '../src/task/schema/review-issue.schema.js';

describe('AntigravityAgentExecutor', () => {
  const dummyTask: InternalTask = {
    id: 'TASK-2001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: process.cwd() },
    requirement: { title: 'Delete User API', description: 'Check references before deletion' },
    priority: 'normal',
    mode: 'auto',
    status: 'REVIEWING',
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
      headCommit: '1234567',
      isClean: false,
      modifiedFiles: ['src/user/service.js'],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: { test: 'npm test' },
    loadedAt: new Date().toISOString(),
  };

  const reviewRequest: ExecutionRequest = {
    role: 'reviewer',
    task: dummyTask,
    projectContext: dummyContext,
    timeoutMs: 5000,
  };

  it('should enforce write: false capability for reviewer role', () => {
    const executor = new AntigravityAgentExecutor({ agentRole: 'reviewer' });
    const caps = executor.getCapabilities();

    expect(caps.read).toBe(true);
    expect(caps.write).toBe(false); // Mandatory rule #6 from AGENTS.md
    expect(caps.shell).toBe(false);
    expect(caps.git).toBe(true);
    expect(caps.test).toBe(true);
  });

  it('should pass healthCheck', async () => {
    const executor = new AntigravityAgentExecutor({
      customRunner: async () => ({ output: 'OK' }),
    });
    const health = await executor.healthCheck();
    expect(health.status).toBe('HEALTHY');
  });

  it('should execute review and return structured PASS ReviewResult', async () => {
    const expectedResult: ReviewResult = {
      round: 1,
      result: 'PASS',
      summary: 'Code quality meets project standards.',
      issues: [],
    };

    const executor = new AntigravityAgentExecutor({
      customRunner: async () => ({
        output: JSON.stringify(expectedResult),
        structuredResult: expectedResult,
      }),
    });

    const response = await executor.execute(reviewRequest);
    expect(response.success).toBe(true);
    expect(response.role).toBe('reviewer');

    const result = response.structuredResult as ReviewResult;
    expect(result.result).toBe('PASS');
    expect(result.issues.length).toBe(0);
  });

  it('should execute review and return structured FAIL ReviewResult with issues', async () => {
    const expectedResult: ReviewResult = {
      round: 1,
      result: 'FAIL',
      summary: 'Found critical issue in user deletion logic.',
      issues: [
        {
          id: 'ISSUE-001',
          severity: 'high',
          category: 'correctness',
          file: 'src/user/service.js',
          description: 'Missing reference check before delete',
          evidence: 'deleteUser(id) directly called without audit check',
          suggestion: 'Add relational check before calling delete',
        },
      ],
    };

    const executor = new AntigravityAgentExecutor({
      customRunner: async () => ({
        output: JSON.stringify(expectedResult),
        structuredResult: expectedResult,
      }),
    });

    const response = await executor.execute(reviewRequest);
    expect(response.success).toBe(true);

    const result = response.structuredResult as ReviewResult;
    expect(result.result).toBe('FAIL');
    expect(result.issues.length).toBe(1);
    expect(result.issues[0].id).toBe('ISSUE-001');
    expect(result.issues[0].severity).toBe('high');
  });
});
