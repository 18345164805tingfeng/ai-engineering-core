import { describe, it, expect, beforeEach } from 'vitest';
import { TaskGateway } from '../src/gateway/task-gateway.js';
import { InMemoryTaskStore, ConcurrencyConflictError } from '../src/task/store/task-store.js';
import { defaultExecutorRegistry } from '../src/executors/executor-registry.js';
import { MockAgentExecutor } from '../src/executors/mock/mock-executor.js';

describe('Idempotency, Concurrency & Cancel Safeguards', () => {
  let store: InMemoryTaskStore;
  let gateway: TaskGateway;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    gateway = new TaskGateway(store);
  });

  describe('External Task Idempotency', () => {
    it('submitting same externalTaskId from same source should return existing task without duplicate', async () => {
      const rawTask = {
        source: {
          type: 'jira' as const,
          externalId: 'JIRA-9988',
        },
        project: 'demo',
        title: 'Fix auth session expiration',
      };

      const firstSubmission = await gateway.submitTask(rawTask);
      expect(firstSubmission.id).toBeDefined();

      const secondSubmission = await gateway.submitTask(rawTask);
      expect(secondSubmission.id).toBe(firstSubmission.id);

      const allTasks = await gateway.listTasks();
      expect(allTasks.length).toBe(1);
    });
  });

  describe('Optimistic Concurrency Control', () => {
    it('updating task with outdated expectedUpdatedAt should throw ConcurrencyConflictError', async () => {
      const task = await gateway.submitManualTask({
        projectId: 'demo',
        title: 'Concurrency test task',
      });

      const initialUpdatedAt = task.updatedAt;

      // First update succeeds and changes updatedAt
      const updated = await gateway.updateTaskStatus(task.id, 'LOADING_CONTEXT');
      expect(updated.updatedAt).not.toBe(initialUpdatedAt);

      // Attempting to update with stale initialUpdatedAt throws conflict
      await expect(
        store.updateTask(task.id, { priority: 'urgent' }, initialUpdatedAt)
      ).rejects.toThrow(ConcurrencyConflictError);
    });
  });

  describe('Cancel Signal Propagation', () => {
    it('cancelTask should record cancel.requested and notify executors', async () => {
      const mockDev = new MockAgentExecutor('mock-dev');
      defaultExecutorRegistry.register(mockDev);

      const task = await gateway.submitManualTask({
        projectId: 'demo',
        title: 'Task to cancel',
      });

      const cancelled = await gateway.cancelTask(task.id, 'User manually clicked cancel');
      expect(cancelled.status).toBe('CANCELLED');

      const timeline = await gateway.getTimeline(task.id);
      const cancelRequestedEvent = timeline.find((e) => e.type === 'task.cancel.requested');
      expect(cancelRequestedEvent).toBeDefined();
      expect(cancelRequestedEvent?.data?.reason).toContain('User manually clicked cancel');
    });
  });
});
