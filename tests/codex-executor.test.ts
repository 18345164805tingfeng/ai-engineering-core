import { describe, it, expect, beforeEach } from 'vitest';
import { CodexAgentExecutor } from '../src/executors/agent/codex-executor.js';
import { ExecutionRequest } from '../src/executors/schema/executor.schema.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { InternalTask } from '../src/task/schema/task.schema.js';

describe('CodexAgentExecutor', () => {
  const dummyTask: InternalTask = {
    id: 'TASK-1001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: process.cwd() },
    requirement: { title: 'Test Task', description: 'Add unit tests' },
    priority: 'normal',
    mode: 'auto',
    status: 'CODING',
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
      headCommit: 'abc1234',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: { test: 'npm test' },
    loadedAt: new Date().toISOString(),
  };

  const sampleRequest: ExecutionRequest = {
    role: 'developer',
    task: dummyTask,
    projectContext: dummyContext,
    prompt: 'Implement feature X',
    timeoutMs: 5000,
  };

  it('should initialize with correct capabilities and ID', () => {
    const executor = new CodexAgentExecutor({ id: 'codex-dev' });
    expect(executor.id).toBe('codex-dev');
    expect(executor.type).toBe('agent');

    const capabilities = executor.getCapabilities();
    expect(capabilities.read).toBe(true);
    expect(capabilities.write).toBe(true);
    expect(capabilities.shell).toBe(true);
    expect(capabilities.git).toBe(true);
    expect(capabilities.test).toBe(true);
  });

  it('should perform healthCheck with customRunner success', async () => {
    const executor = new CodexAgentExecutor({
      id: 'codex',
      customRunner: async () => ({
        exitCode: 0,
        stdout: 'codex version 1.0.0',
        stderr: '',
      }),
    });

    const health = await executor.healthCheck();
    expect(health.status).toBe('HEALTHY');
    expect(health.executorId).toBe('codex');
  });

  it('should handle healthCheck failure', async () => {
    const executor = new CodexAgentExecutor({
      id: 'codex',
      customRunner: async () => {
        throw new Error('CLI command not found');
      },
    });

    const health = await executor.healthCheck();
    expect(health.status).toBe('UNAVAILABLE');
    expect(health.consecutiveFailures).toBe(1);
    expect(health.lastError).toContain('CLI command not found');
  });

  it('should execute prompt successfully via customRunner', async () => {
    const executor = new CodexAgentExecutor({
      id: 'codex',
      customRunner: async (cmd, args, opts) => {
        expect(cmd).toBe('codex');
        expect(args).toContain('Implement feature X');
        expect(opts.cwd).toBe(process.cwd());
        return {
          exitCode: 0,
          stdout: 'Created feature X successfully',
          stderr: '',
        };
      },
    });

    const response = await executor.execute(sampleRequest);
    expect(response.success).toBe(true);
    expect(response.output).toBe('Created feature X successfully');
    expect(response.executorId).toBe('codex');
    expect(response.role).toBe('developer');
  });

  it('should handle execution failure via customRunner', async () => {
    const executor = new CodexAgentExecutor({
      id: 'codex',
      customRunner: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'Syntax error in code',
      }),
    });

    const response = await executor.execute(sampleRequest);
    expect(response.success).toBe(false);
    expect(response.error).toContain('Syntax error in code');
  });

  it('should support cancellation', async () => {
    const executor = new CodexAgentExecutor({ id: 'codex' });
    const cancelResult = await executor.cancel('non-existent-run');
    expect(cancelResult).toBe(false);
  });
});
