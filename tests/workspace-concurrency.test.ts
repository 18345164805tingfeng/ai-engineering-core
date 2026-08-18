import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectLockManager } from '../src/workspace/project-lock-manager.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';
import { ExecutorConcurrencyManager } from '../src/scheduler/executor-concurrency-manager.js';
import { WorkflowScheduler } from '../src/scheduler/workflow-scheduler.js';

describe('Phase F: Workspace & Safe Concurrency', () => {
  let lockManager: ProjectLockManager;
  let workspaceManager: WorkspaceManager;
  let executorConcurrency: ExecutorConcurrencyManager;
  let scheduler: WorkflowScheduler;

  beforeEach(() => {
    lockManager = new ProjectLockManager();
    workspaceManager = new WorkspaceManager(lockManager);
    executorConcurrency = new ExecutorConcurrencyManager();
    scheduler = new WorkflowScheduler(2);
  });

  describe('ProjectLockManager & WorkspaceManager', () => {
    it('different projects can acquire workspace locks concurrently', async () => {
      const wsA = await workspaceManager.acquireWorkspace({ id: 'project-A', root: '/path/A' }, 'TASK-A');
      const wsB = await workspaceManager.acquireWorkspace({ id: 'project-B', root: '/path/B' }, 'TASK-B');

      expect(wsA.id).toBe('ws-project-A-TASK-A');
      expect(wsB.id).toBe('ws-project-B-TASK-B');
      expect(lockManager.isLocked('project-A')).toBe(true);
      expect(lockManager.isLocked('project-B')).toBe(true);
    });

    it('same project enforces mutual exclusion: second task queues until first releases', async () => {
      let task2Acquired = false;

      // Task 1 acquires lock
      await workspaceManager.acquireWorkspace({ id: 'demo', root: '/demo' }, 'TASK-1');
      expect(lockManager.getCurrentOwner('demo')).toBe('TASK-1');

      // Task 2 attempts to acquire lock asynchronously
      const task2Promise = workspaceManager
        .acquireWorkspace({ id: 'demo', root: '/demo' }, 'TASK-2')
        .then((ws) => {
          task2Acquired = true;
          return ws;
        });

      // Give event loop a cycle
      await new Promise((r) => setTimeout(r, 20));
      expect(task2Acquired).toBe(false);
      expect(lockManager.getWaitingQueue('demo')).toContain('TASK-2');

      // Task 1 releases workspace
      await workspaceManager.releaseWorkspace('demo', 'TASK-1');

      // Task 2 should now have acquired the lock
      const ws2 = await task2Promise;
      expect(task2Acquired).toBe(true);
      expect(ws2.id).toBe('ws-demo-TASK-2');
      expect(lockManager.getCurrentOwner('demo')).toBe('TASK-2');
    });
  });

  describe('ExecutorConcurrencyManager', () => {
    it('enforces slot limit per executor (e.g. single GPU ollama limit = 1)', async () => {
      executorConcurrency.setLimit('ollama', 1);

      const slot1 = await executorConcurrency.acquireSlot('ollama', 'TASK-1');
      expect(slot1).toBe(true);
      expect(executorConcurrency.getActiveCount('ollama')).toBe(1);

      let task2SlotAcquired = false;
      const slot2Promise = executorConcurrency.acquireSlot('ollama', 'TASK-2').then((res) => {
        task2SlotAcquired = true;
        return res;
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(task2SlotAcquired).toBe(false);

      executorConcurrency.releaseSlot('ollama', 'TASK-1');
      await slot2Promise;

      expect(task2SlotAcquired).toBe(true);
      expect(executorConcurrency.getActiveCount('ollama')).toBe(1);
    });
  });

  describe('WorkflowScheduler', () => {
    it('schedules tasks within maxConcurrentRuns limit and queues excess', async () => {
      scheduler.setMaxConcurrentRuns(2);
      const executionOrder: string[] = [];

      const runJob = (name: string, durationMs: number) => {
        return scheduler.schedule(name, `RUN-${name}`, async () => {
          executionOrder.push(`${name}-start`);
          await new Promise((r) => setTimeout(r, durationMs));
          executionOrder.push(`${name}-end`);
          return name;
        });
      };

      const p1 = runJob('JOB-1', 40);
      const p2 = runJob('JOB-2', 40);
      const p3 = runJob('JOB-3', 20);

      expect(scheduler.getActiveCount()).toBe(2);
      expect(scheduler.getQueuedCount()).toBe(1);

      await Promise.all([p1, p2, p3]);

      expect(executionOrder.filter((s) => s.endsWith('-start')).length).toBe(3);
      expect(executionOrder.indexOf('JOB-3-start')).toBeGreaterThanOrEqual(2);
    });
  });
});
