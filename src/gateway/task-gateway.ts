import { Task } from '../task/schema/task.schema.js';
import { TimelineEvent } from '../task/schema/timeline.schema.js';
import { TaskStatus } from '../task/state/task-state.js';
import { defaultTaskStore, ITaskStore } from '../task/store/task-store.js';
import { ManualSource, ManualTaskInput } from './sources/manual-source.js';
import { ITaskSource, RawExternalTask } from './sources/task-source.js';
import { TaskNormalizer } from './normalizer/task-normalizer.js';

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

  async submitTask(raw: RawExternalTask, options?: { taskId?: string }): Promise<Task> {
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
    options?: { message?: string; executor?: string; payload?: Record<string, unknown> }
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

  async cancelTask(taskId: string, reason = 'Task cancelled by user'): Promise<Task> {
    return this.updateTaskStatus(taskId, 'CANCELLED', {
      message: reason,
      payload: { reason },
    });
  }

  async listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]> {
    return this.store.listTasks(filter);
  }
}

// Export default singleton gateway instance
export const defaultTaskGateway = new TaskGateway();
