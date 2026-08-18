import { Task } from '../task/schema/task.schema.js';
import { TimelineEvent } from '../task/schema/timeline.schema.js';
import { TaskStatus } from '../task/state/task-state.js';
import { defaultTaskStore, ITaskStore } from '../task/store/task-store.js';
import { ManualSource, ManualTaskInput } from './sources/manual-source.js';
import { ITaskSource, RawExternalTask } from './sources/task-source.js';
import { TaskNormalizer } from './normalizer/task-normalizer.js';
import { defaultExecutorRegistry } from '../executors/executor-registry.js';
import { SecretRedactor } from '../security/secret-redactor.js';

export class TaskGateway {
  private store: ITaskStore;
  private sources: Map<string, ITaskSource> = new Map();
  private manualSource: ManualSource;

  constructor(store: ITaskStore = defaultTaskStore) {
    this.store = store;
    this.manualSource = new ManualSource();
    this.registerSource(this.manualSource);
  }

  registerSource(source: ITaskSource): void {
    this.sources.set(source.sourceType, source);
  }

  getSource(type: string): ITaskSource | undefined {
    return this.sources.get(type);
  }

  async submitManualTask(input: ManualTaskInput, options?: { taskId?: string }): Promise<Task> {
    const raw = this.manualSource.createRawTask(input);
    return this.submitTask(raw, options);
  }

  /**
   * Submits a raw external task with idempotency check on (source.type + source.externalId)
   */
  async submitTask(raw: RawExternalTask | any, options?: { taskId?: string }): Promise<Task> {
    const externalId = raw.externalId || raw.source?.externalId;
    const sourceType = raw.sourceType || raw.source?.type || 'manual';

    // 1. Idempotency Check: if externalId is provided, check for existing task
    if (externalId) {
      const existingTasks = await this.store.listTasks();
      const duplicate = existingTasks.find(
        (t) => t.source.type === sourceType && t.source.externalId === externalId
      );
      if (duplicate) {
        return duplicate;
      }
    }

    const normalizedTask = TaskNormalizer.normalize(raw, options);
    return this.store.createTask(normalizedTask);
  }

  async getTask(taskId: string): Promise<Task | null> {
    return this.store.getTask(taskId);
  }

  async getTimeline(taskId: string): Promise<TimelineEvent[]> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task with id '${taskId}' not found.`);
    }
    return task.timeline;
  }

  async updateTaskStatus(
    taskId: string,
    newStatus: TaskStatus,
    options?: {
      message?: string;
      summary?: string;
      executor?: string;
      artifactId?: string;
      data?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  ): Promise<Task> {
    const updated = await this.store.updateStatus(taskId, newStatus, options);

    // If source supports status synchronization, notify source
    const source = this.sources.get(updated.source.type);
    if (source?.updateStatus && updated.source.externalId) {
      try {
        await source.updateStatus(updated.source.externalId, newStatus);
      } catch (err) {
        console.warn(`Failed to sync status ${newStatus} to external source ${updated.source.type}:`, err);
      }
    }

    return updated;
  }

  /**
   * Cancels a task and propagates cancellation signal to running executors
   */
  async cancelTask(taskId: string, reason = 'Task cancelled by user'): Promise<Task> {
    // 1. First record cancel.requested event
    await this.store.appendTimeline(taskId, {
      type: 'task.cancel.requested',
      summary: `Cancel requested for task ${taskId}`,
      message: reason,
      data: { reason: SecretRedactor.redactText(reason) },
    }).catch(() => {});

    // 2. Propagate cancel signal to all registered executors if active
    const executors = defaultExecutorRegistry.getAll();
    for (const executor of executors) {
      try {
        await executor.cancel(taskId);
      } catch (err) {
        console.warn(`Executor '${executor.id}' cancel failed for task '${taskId}':`, err);
      }
    }

    // 3. Transition status to CANCELLED
    return this.updateTaskStatus(taskId, 'CANCELLED', {
      summary: `Task ${taskId} cancelled`,
      message: reason,
      data: { reason: SecretRedactor.redactText(reason) },
    });
  }

  async listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]> {
    return this.store.listTasks(filter);
  }
}

// Export default singleton gateway instance
export const defaultTaskGateway = new TaskGateway();
