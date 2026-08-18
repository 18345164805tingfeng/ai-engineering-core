import { describe, it, expect, beforeEach } from 'vitest';
import { defaultTaskGateway, TaskGateway } from '../src/gateway/task-gateway.js';
import { defaultWorkflowRunManager, WorkflowRunManager } from '../src/workflow/run/workflow-run-manager.js';
import { InMemoryTaskStore } from '../src/task/store/task-store.js';

describe('Phase E: Multiple Workflow Runs Isolation', () => {
  let customStore: InMemoryTaskStore;
  let gateway: TaskGateway;
  let runManager: WorkflowRunManager;

  beforeEach(() => {
    customStore = new InMemoryTaskStore();
    runManager = new WorkflowRunManager();
    gateway = new TaskGateway(customStore);
  });

  it('submitting multiple tasks creates distinct runIds and isolated run instances', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 1: Add authentication' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'comfyui',
      requirement: { title: 'Task 2: Add custom nodes' },
    });

    expect(task1.workflow.runId).toBeDefined();
    expect(task2.workflow.runId).toBeDefined();
    expect(task1.workflow.runId).not.toBe(task2.workflow.runId);

    const run1 = defaultWorkflowRunManager.getRunByTaskId(task1.id);
    const run2 = defaultWorkflowRunManager.getRunByTaskId(task2.id);

    expect(run1).toBeDefined();
    expect(run2).toBeDefined();
    expect(run1?.taskId).toBe(task1.id);
    expect(run2?.taskId).toBe(task2.id);
    expect(run1?.runId).not.toBe(run2?.runId);
  });

  it('cancelling Task 1 cancels Run 1 without affecting Run 2', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 1 to be cancelled' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 2 remaining active' },
    });

    const run1Before = defaultWorkflowRunManager.getRunByTaskId(task1.id);
    const run2Before = defaultWorkflowRunManager.getRunByTaskId(task2.id);

    expect(run1Before?.status).toBe('PENDING');
    expect(run2Before?.status).toBe('PENDING');

    // Cancel Task 1
    const cancelledTask1 = await gateway.cancelTask(task1.id, 'User stopped Task 1');

    expect(cancelledTask1.status).toBe('CANCELLED');

    const run1After = defaultWorkflowRunManager.getRunByTaskId(task1.id);
    const run2After = defaultWorkflowRunManager.getRunByTaskId(task2.id);

    expect(run1After?.status).toBe('CANCELLED');
    expect(run1After?.abortController.signal.aborted).toBe(true);

    // Run 2 must remain completely intact
    expect(run2After?.status).toBe('PENDING');
    expect(run2After?.abortController.signal.aborted).toBe(false);
  });

  it('timeline events and steps are strictly isolated between task runs', async () => {
    const task1 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 1' },
    });

    const task2 = await gateway.submitManualTask({
      project: 'demo',
      requirement: { title: 'Task 2' },
    });

    await customStore.appendTimeline(task1.id, {
      type: 'test.step.task1',
      summary: 'Task 1 unique event',
      data: { runId: task1.workflow.runId },
    });

    const refreshedTask1 = await customStore.getTask(task1.id);
    const refreshedTask2 = await customStore.getTask(task2.id);

    expect(refreshedTask1?.timeline.some((t) => t.type === 'test.step.task1')).toBe(true);
    expect(refreshedTask2?.timeline.some((t) => t.type === 'test.step.task1')).toBe(false);
  });
});
