import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockAgentExecutor,
  MockModelExecutor,
  ExecutorRegistry,
  HealthManager,
  ExecutorRouter,
  Task,
  ProjectContext,
  defaultExecutorRouter,
  defaultExecutorRegistry,
  defaultHealthManager,
} from '../src/index.js';

describe('Phase 3: Executor Core & Router', () => {
  let registry: ExecutorRegistry;
  let healthManager: HealthManager;
  let router: ExecutorRouter;

  const sampleTask: Task = {
    id: 'TASK-20260817-001',
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: 'demo', root: '/workspace/demo' },
    requirement: { title: '增加删除功能', description: '', constraints: [] },
    priority: 'normal',
    mode: 'standard',
    status: 'CODING',
    analysis: { type: null, complexity: null, risk: null },
    plan: null,
    execution: { round: 0, changes: [] },
    verification: { results: [] },
    review: { round: 0, result: null, issues: [] },
    arbitration: null,
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleContext: ProjectContext = {
    projectId: 'demo',
    projectName: 'Demo Project',
    projectRoot: '/workspace/demo',
    agentsDoc: '# Rules',
    readmeDoc: '# Demo',
    projectYaml: null,
    manifest: {
      type: 'node',
      name: 'demo',
      dependencies: [],
      devDependencies: [],
      scripts: { test: 'npm test' },
    },
    git: {
      isGitRepo: true,
      branch: 'main',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    commands: { test: 'npm test' },
    dirSummary: ['src/'],
    loadedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    registry = new ExecutorRegistry();
    healthManager = new HealthManager({ failureThreshold: 2 });
    router = new ExecutorRouter({ registry, healthManager });

    router.setRolesConfig({
      roles: {
        router: { primary: 'mock-qwen', fallback: [] },
        planner: { primary: 'mock-antigravity-planner', fallback: ['mock-qwen'] },
        developer: { primary: 'mock-codex', fallback: ['mock-qwen-coder'] },
        reviewer: { primary: 'mock-antigravity-reviewer', fallback: ['mock-qwen'] },
        tester: { primary: 'mock-codex', fallback: ['mock-qwen-coder'] },
        architect: { primary: 'mock-antigravity-architect', fallback: ['mock-qwen'] },
      },
    });
  });

  describe('Executor Interfaces & Capabilities', () => {
    it('should distinguish AgentExecutor and ModelExecutor capabilities', () => {
      const agent = new MockAgentExecutor('codex-agent');
      const model = new MockModelExecutor('qwen-model');

      expect(agent.type).toBe('agent');
      expect(agent.getCapabilities().write).toBe(true);
      expect(agent.getCapabilities().shell).toBe(true);
      expect(agent.getCapabilities().test).toBe(true);

      expect(model.type).toBe('model');
      expect(model.getCapabilities().write).toBe(false);
      expect(model.getCapabilities().shell).toBe(false);
      expect(model.getCapabilities().read).toBe(true);
    });

    it('should handle execution timeout gracefully', async () => {
      const slowAgent = new MockAgentExecutor('slow-agent', { delayMs: 100 });
      const res = await slowAgent.execute({
        role: 'developer',
        task: sampleTask,
        projectContext: sampleContext,
        timeoutMs: 20, // 20ms < 100ms
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('timed out after 20ms');
    });
  });

  describe('HealthManager', () => {
    it('should track success latency and transition to UNAVAILABLE after failure threshold', () => {
      healthManager.recordSuccess('exec-1', 120);
      expect(healthManager.getHealth('exec-1').status).toBe('HEALTHY');
      expect(healthManager.getHealth('exec-1').latencyMs).toBe(120);
      expect(healthManager.isAvailable('exec-1')).toBe(true);

      // First failure -> DEGRADED
      healthManager.recordFailure('exec-1', 'network error 1');
      expect(healthManager.getHealth('exec-1').status).toBe('DEGRADED');
      expect(healthManager.isAvailable('exec-1')).toBe(true);

      // Second failure -> UNAVAILABLE (threshold = 2)
      healthManager.recordFailure('exec-1', 'network error 2');
      expect(healthManager.getHealth('exec-1').status).toBe('UNAVAILABLE');
      expect(healthManager.isAvailable('exec-1')).toBe(false);
    });
  });

  describe('ExecutorRouter & Fallback Mechanism', () => {
    it('should route executeRole to primary executor when healthy', async () => {
      const codex = new MockAgentExecutor('mock-codex');
      registry.registerExecutor(codex);

      const res = await router.executeRole({
        role: 'developer',
        task: sampleTask,
        projectContext: sampleContext,
      });

      expect(res.success).toBe(true);
      expect(res.executorId).toBe('mock-codex');
      expect(res.role).toBe('developer');
    });

    it('should automatically fallback to secondary executor when primary fails', async () => {
      const failingCodex = new MockAgentExecutor('mock-codex', {
        simulateFailure: true,
        failureError: 'Codex API token invalid',
      });
      const backupQwen = new MockModelExecutor('mock-qwen-coder', {
        responseHandler: async () => ({
          output: 'Qwen Coder successfully fixed code',
          structuredResult: { fixed: true },
        }),
      });

      registry.registerExecutor(failingCodex);
      registry.registerExecutor(backupQwen);

      const res = await router.executeRole({
        role: 'developer',
        task: sampleTask,
        projectContext: sampleContext,
      });

      expect(res.success).toBe(true);
      expect(res.executorId).toBe('mock-qwen-coder');
      expect(res.output).toBe('Qwen Coder successfully fixed code');

      // Check that primary failure was recorded in HealthManager
      expect(healthManager.getHealth('mock-codex').consecutiveFailures).toBe(1);
    });

    it('should report comprehensive failure when all candidates fail', async () => {
      const failingPrimary = new MockAgentExecutor('mock-codex', { simulateFailure: true });
      const failingFallback = new MockModelExecutor('mock-qwen-coder', { simulateFailure: true });

      registry.registerExecutor(failingPrimary);
      registry.registerExecutor(failingFallback);

      const res = await router.executeRole({
        role: 'developer',
        task: sampleTask,
        projectContext: sampleContext,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("All candidate executors failed for role 'developer'");
      expect(res.error).toContain('mock-codex');
      expect(res.error).toContain('mock-qwen-coder');
    });
  });

  describe('Default Instances Availability', () => {
    it('should have defaultExecutorRouter, defaultExecutorRegistry, and defaultHealthManager available', () => {
      expect(defaultExecutorRouter).toBeDefined();
      expect(defaultExecutorRegistry).toBeDefined();
      expect(defaultHealthManager).toBeDefined();
    });
  });
});
