import { describe, it, expect } from 'vitest';
import {
  StepStatusSchema,
  StepResultSchema,
  WorkflowRunInfoSchema,
  TaskWorkspaceSchema,
  TaskSchedulingSchema,
} from '../src/workflow/schema/step.schema.js';
import { TaskSchema } from '../src/task/schema/task.schema.js';

describe('Phase B: Workflow Step & Task Run Schema', () => {
  it('should validate all standard StepStatus enum values', () => {
    const validStatuses = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED', 'CANCELLED'];
    for (const status of validStatuses) {
      expect(StepStatusSchema.parse(status)).toBe(status);
    }
    expect(() => StepStatusSchema.parse('UNKNOWN')).toThrow();
  });

  it('should validate a structured StepResult', () => {
    const now = new Date().toISOString();
    const stepResult = {
      id: 'develop',
      status: 'COMPLETED' as const,
      startedAt: now,
      endedAt: now,
      durationMs: 3450,
      executor: 'codex',
      model: 'gpt-5-codex',
      summary: 'Developed user delete feature and added service tests',
      artifactIds: ['ART-001', 'ART-002'],
      data: { changesCount: 3 },
    };

    const parsed = StepResultSchema.parse(stepResult);
    expect(parsed.id).toBe('develop');
    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.artifactIds.length).toBe(2);
  });

  it('TaskSchema should automatically provide defaults for workflow, steps, workspace, and scheduling', () => {
    const now = new Date().toISOString();
    const minimalTask = {
      id: 'TASK-PHASE-B-1',
      source: { type: 'manual' as const },
      project: { id: 'demo' },
      requirement: { title: 'Test backward compatibility' },
      createdAt: now,
      updatedAt: now,
    };

    const parsed = TaskSchema.parse(minimalTask);
    expect(parsed.workflow).toBeDefined();
    expect(parsed.workflow.workflowId).toBe('software-development');
    expect(parsed.workflow.runId).toBeNull();
    expect(parsed.workflow.currentStep).toBeNull();

    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBe(0);

    expect(parsed.workspace.mode).toBe('shared-lock');
    expect(parsed.workspace.id).toBeNull();

    expect(parsed.scheduling.status).toBe('READY');
    expect(parsed.scheduling.queuedAt).toBeNull();
  });

  it('TaskSchema should accept customized workflow run and scheduling info', () => {
    const now = new Date().toISOString();
    const richTask = {
      id: 'TASK-PHASE-B-2',
      source: { type: 'jira' as const, externalId: 'JIRA-123' },
      project: { id: 'comfyui' },
      requirement: { title: 'Custom workflow task' },
      workflow: {
        workflowId: 'software-development',
        runId: 'RUN-20260818-001',
        currentStep: 'verify',
      },
      steps: [
        {
          id: 'plan-task',
          status: 'COMPLETED' as const,
          startedAt: now,
          summary: 'Plan completed',
          artifactIds: [],
        },
      ],
      workspace: {
        id: 'ws-comfyui-1',
        mode: 'shared-lock' as const,
        root: 'F:/try/ComfyUI',
        branch: 'main',
        baseBranch: 'main',
      },
      scheduling: {
        status: 'RUNNING' as const,
        queuedAt: now,
        startedAt: now,
        waitingReason: null,
      },
      createdAt: now,
      updatedAt: now,
    };

    const parsed = TaskSchema.parse(richTask);
    expect(parsed.workflow.runId).toBe('RUN-20260818-001');
    expect(parsed.workflow.currentStep).toBe('verify');
    expect(parsed.steps.length).toBe(1);
    expect(parsed.workspace.root).toBe('F:/try/ComfyUI');
    expect(parsed.scheduling.status).toBe('RUNNING');
  });
});
