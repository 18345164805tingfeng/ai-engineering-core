import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadContextStep,
  analyzeTaskStep,
  planTaskStep,
  acquireWorkspaceStep,
  developStep,
  verifyStep,
  reviewStep,
  fixStep,
  arbitrateStep,
  finalizeStep,
  releaseWorkspaceStep,
  softwareDevelopmentWorkflow,
} from '../src/mastra/workflows/software-development.js';
import { Task } from '../src/task/schema/task.schema.js';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import { defaultTaskStore, InMemoryTaskStore } from '../src/task/store/task-store.js';

describe('Phase C: Workflow Decomposition & Atomic Steps', () => {
  let mockTask: Task;
  let mockContext: ProjectContext;

  beforeEach(async () => {
    const now = new Date().toISOString();
    mockTask = {
      id: `TASK-DECOMP-${Date.now()}`,
      source: { type: 'manual' },
      project: { id: 'demo', root: process.cwd() },
      requirement: {
        title: 'Add security check feature',
        description: 'Implement security check and sanitize user input with tests',
        constraints: ['strict type-safety'],
      },
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
      workflow: { workflowId: 'software-development', runId: `RUN-TEST-001`, currentStep: null },
      steps: [],
      workspace: { id: null, mode: 'shared-lock', root: null, branch: null, baseBranch: null },
      scheduling: { status: 'READY', queuedAt: null, startedAt: null, waitingReason: null },
      createdAt: now,
      updatedAt: now,
    };

    mockContext = {
      projectId: 'demo',
      projectRoot: process.cwd(),
      commands: { test: 'echo test passed' },
    };

    await defaultTaskStore.createTask(mockTask);
  });

  it('loadContextStep should load project context and record tracked step', async () => {
    const res = await loadContextStep.execute({
      inputData: { task: mockTask, projectContext: mockContext },
    } as any);

    expect(res.task.status).toBe('LOADING_CONTEXT');
    expect(res.task.steps.some((s) => s.id === 'load-context')).toBe(true);
  });

  it('analyzeTaskStep should assess complexity and risk', async () => {
    const res = await analyzeTaskStep.execute({
      inputData: { task: mockTask, projectContext: mockContext },
    } as any);

    expect(res.task.status).toBe('ANALYZING');
    expect(res.task.analysis?.complexity).toBeDefined();
    expect(res.task.steps.some((s) => s.id === 'analyze-task')).toBe(true);
  });

  it('planTaskStep should generate plan and create plan artifact', async () => {
    const res = await planTaskStep.execute({
      inputData: { task: mockTask, projectContext: mockContext },
    } as any);

    expect(res.task.status).toBe('PLANNING');
    expect(res.task.plan).toBeDefined();
    expect(res.task.steps.some((s) => s.id === 'plan-task')).toBe(true);
  });

  it('acquireWorkspaceStep & releaseWorkspaceStep should manage workspace lifecycle', async () => {
    const acquireRes = await acquireWorkspaceStep.execute({
      inputData: { task: mockTask, projectContext: mockContext },
    } as any);

    expect(acquireRes.task.workspace.id).toBeDefined();
    expect(acquireRes.task.steps.some((s) => s.id === 'acquire-workspace')).toBe(true);

    const releaseRes = await releaseWorkspaceStep.execute({
      inputData: { task: acquireRes.task, projectContext: mockContext },
    } as any);

    expect(releaseRes.released).toBe(true);
    expect(releaseRes.task.steps.some((s) => s.id === 'release-workspace')).toBe(true);
  });

  it('finalizeStep should mark task as DONE and record step result', async () => {
    const res = await finalizeStep.execute({
      inputData: {
        task: mockTask,
        projectContext: mockContext,
        reviewResult: { round: 1, result: 'PASS', issues: [] },
      },
    } as any);

    expect(res.task.status).toBe('DONE');
    expect(res.finalStatus).toBe('DONE');
    expect(res.task.steps.some((s) => s.id === 'finalize' && s.status === 'COMPLETED')).toBe(true);
  });

  it('softwareDevelopmentWorkflow definition should contain all decomposed steps', () => {
    expect(softwareDevelopmentWorkflow).toBeDefined();
    expect(softwareDevelopmentWorkflow.id).toBe('software-development-workflow');
  });
});
