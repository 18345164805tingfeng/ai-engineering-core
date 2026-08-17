import { describe, it, expect } from 'vitest';
import { OllamaModelExecutor } from '../src/executors/model/ollama-executor.js';
import { MockAgentExecutor } from '../src/executors/mock/mock-executor.js';
import { ExecutorRegistry } from '../src/executors/executor-registry.js';
import { ExecutorRouter } from '../src/router/executor-router.js';
import { HealthManager } from '../src/router/health-manager.js';
import { ExecutionRequest } from '../src/executors/schema/executor.schema.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { InternalTask } from '../src/task/schema/task.schema.js';

describe('OllamaModelExecutor & Automatic Fallback', () => {
  const dummyTask: InternalTask = {
    id: 'TASK-4001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: process.cwd() },
    requirement: { title: 'Routing Task', description: 'Analyze task type' },
    priority: 'normal',
    mode: 'auto',
    status: 'ANALYZING',
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
      headCommit: '445566',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: { test: 'npm test' },
    loadedAt: new Date().toISOString(),
  };

  const sampleRequest: ExecutionRequest = {
    role: 'router',
    task: dummyTask,
    projectContext: dummyContext,
    prompt: 'Categorize requirement',
    timeoutMs: 5000,
  };

  it('should initialize with correct capabilities and defaults', () => {
    const executor = new OllamaModelExecutor({ id: 'qwen-local' });
    expect(executor.id).toBe('qwen-local');
    expect(executor.type).toBe('model');

    const caps = executor.getCapabilities();
    expect(caps.read).toBe(true);
    expect(caps.write).toBe(false);
    expect(caps.shell).toBe(false);
    expect(caps.git).toBe(false);
    expect(caps.test).toBe(false);
  });

  it('should pass healthCheck via customRunner', async () => {
    const executor = new OllamaModelExecutor({
      id: 'qwen-local',
      customRunner: async () => ({ output: 'OK' }),
    });

    const health = await executor.healthCheck();
    expect(health.status).toBe('HEALTHY');
    expect(health.executorId).toBe('qwen-local');
  });

  it('should execute prompt successfully via customRunner', async () => {
    const executor = new OllamaModelExecutor({
      id: 'qwen-local',
      customRunner: async (req) => ({
        output: 'Complexity: low, Risk: low',
        structuredResult: { type: 'feature', complexity: 'low', risk: 'low' },
      }),
    });

    const response = await executor.execute(sampleRequest);
    expect(response.success).toBe(true);
    expect(response.output).toBe('Complexity: low, Risk: low');
    expect(response.executorId).toBe('qwen-local');
  });

  it('should automatically fall back to Qwen Local when Primary executor fails', async () => {
    const registry = new ExecutorRegistry();
    const healthManager = new HealthManager();

    // Primary executor: failing mock codex
    const failingPrimary = new MockAgentExecutor('codex-cloud', {
      simulateFailure: true,
      failureError: 'Cloud API 503 Service Unavailable',
    });
    registry.registerExecutor(failingPrimary);

    // Fallback executor: Qwen Local Ollama
    const qwenLocal = new OllamaModelExecutor({
      id: 'qwen-local',
      customRunner: async () => ({
        output: 'Fallback execution completed by Qwen Local',
      }),
    });
    registry.registerExecutor(qwenLocal);

    const router = new ExecutorRouter({
      registry,
      healthManager,
    });

    router.setRolesConfig({
      roles: {
        developer: { primary: 'codex-cloud', fallback: ['qwen-local'] },
        reviewer: { primary: 'qwen-local', fallback: [] },
        planner: { primary: 'qwen-local', fallback: [] },
        tester: { primary: 'qwen-local', fallback: [] },
        architect: { primary: 'qwen-local', fallback: [] },
        router: { primary: 'qwen-local', fallback: [] },
      },
    });

    const response = await router.executeRole({
      role: 'developer',
      task: dummyTask,
      projectContext: dummyContext,
      prompt: 'Implement feature with fallback',
    });

    expect(response.success).toBe(true);
    expect(response.executorId).toBe('qwen-local');
    expect(response.output).toBe('Fallback execution completed by Qwen Local');
  });

  it('should automatically fall back to Qwen Local when Primary executor health is UNAVAILABLE', async () => {
    const registry = new ExecutorRegistry();
    const healthManager = new HealthManager();

    // Mark primary as UNAVAILABLE in health manager
    healthManager.recordFailure('primary-dev', 'Network timeout');
    healthManager.recordFailure('primary-dev', 'Network timeout');
    healthManager.recordFailure('primary-dev', 'Network timeout');

    const primaryDev = new MockAgentExecutor('primary-dev');
    registry.registerExecutor(primaryDev);

    const qwenLocal = new OllamaModelExecutor({
      id: 'qwen-local',
      customRunner: async () => ({
        output: 'Fallback execution because Primary is marked UNAVAILABLE',
      }),
    });
    registry.registerExecutor(qwenLocal);

    const router = new ExecutorRouter({
      registry,
      healthManager,
    });

    router.setRolesConfig({
      roles: {
        developer: { primary: 'primary-dev', fallback: ['qwen-local'] },
        reviewer: { primary: 'qwen-local', fallback: [] },
        planner: { primary: 'qwen-local', fallback: [] },
        tester: { primary: 'qwen-local', fallback: [] },
        architect: { primary: 'qwen-local', fallback: [] },
        router: { primary: 'qwen-local', fallback: [] },
      },
    });

    const response = await router.executeRole({
      role: 'developer',
      task: dummyTask,
      projectContext: dummyContext,
    });

    expect(response.success).toBe(true);
    expect(response.executorId).toBe('qwen-local');
    expect(response.output).toContain('Primary is marked UNAVAILABLE');
  });
});
