import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Task, TaskSchema } from '../schema/task.schema.js';
import { TimelineEvent } from '../schema/timeline.schema.js';
import { TaskStatus, validateStatusTransition } from '../state/task-state.js';

export interface ITaskStore {
  createTask(task: Task): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  updateStatus(
    id: string,
    newStatus: TaskStatus,
    options?: { message?: string; executor?: string; payload?: Record<string, unknown> }
  ): Promise<Task>;
  appendTimeline(
    id: string,
    event: { type: string; executor?: string; message?: string; payload?: Record<string, unknown> }
  ): Promise<Task>;
  listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]>;
}

export class InMemoryTaskStore implements ITaskStore {
  protected tasks: Map<string, Task> = new Map();

  async createTask(taskData: Task): Promise<Task> {
    const validated = TaskSchema.parse(taskData);
    if (this.tasks.has(validated.id)) {
      throw new Error(`Task with id '${validated.id}' already exists.`);
    }

    const now = new Date().toISOString();
    const task: Task = {
      ...validated,
      createdAt: validated.createdAt || now,
      updatedAt: now,
    };

    // Auto-record creation event in timeline if not already recorded
    if (task.timeline.length === 0) {
      task.timeline.push({
        id: randomUUID(),
        type: 'TASK_CREATED',
        timestamp: now,
        message: `Task ${task.id} created with status ${task.status}`,
        payload: {
          projectId: task.project.id,
          source: task.source.type,
        },
      });
    }

    this.tasks.set(task.id, task);
    return structuredClone(task);
  }

  async getTask(id: string): Promise<Task | null> {
    const task = this.tasks.get(id);
    return task ? structuredClone(task) : null;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Task with id '${id}' not found.`);
    }

    if (updates.status && updates.status !== existing.status) {
      validateStatusTransition(existing.status, updates.status);
    }

    const now = new Date().toISOString();
    const merged: Task = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now,
    };

    const validated = TaskSchema.parse(merged);
    this.tasks.set(id, validated);
    return structuredClone(validated);
  }

  async updateStatus(
    id: string,
    newStatus: TaskStatus,
    options?: { message?: string; executor?: string; payload?: Record<string, unknown> }
  ): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Task with id '${id}' not found.`);
    }

    validateStatusTransition(existing.status, newStatus);

    const now = new Date().toISOString();
    const timelineEvent: TimelineEvent = {
      id: randomUUID(),
      type: 'STATUS_CHANGED',
      timestamp: now,
      executor: options?.executor,
      message: options?.message || `Status changed from ${existing.status} to ${newStatus}`,
      payload: {
        previousStatus: existing.status,
        newStatus,
        ...options?.payload,
      },
    };

    const updated: Task = {
      ...existing,
      status: newStatus,
      updatedAt: now,
      timeline: [...existing.timeline, timelineEvent],
    };

    const validated = TaskSchema.parse(updated);
    this.tasks.set(id, validated);
    return structuredClone(validated);
  }

  async appendTimeline(
    id: string,
    event: { type: string; executor?: string; message?: string; payload?: Record<string, unknown> }
  ): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Task with id '${id}' not found.`);
    }

    const now = new Date().toISOString();
    const timelineEvent: TimelineEvent = {
      id: randomUUID(),
      type: event.type,
      timestamp: now,
      executor: event.executor,
      message: event.message,
      payload: event.payload,
    };

    const updated: Task = {
      ...existing,
      updatedAt: now,
      timeline: [...existing.timeline, timelineEvent],
    };

    const validated = TaskSchema.parse(updated);
    this.tasks.set(id, validated);
    return structuredClone(validated);
  }

  async listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]> {
    let result = Array.from(this.tasks.values());
    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.projectId) {
      result = result.filter((t) => t.project.id === filter.projectId);
    }
    return structuredClone(result);
  }
}

export class FileTaskStore extends InMemoryTaskStore {
  private filePath: string;

  constructor(storageDir?: string) {
    super();
    const dir = storageDir || path.resolve(process.cwd(), '.data');
    this.filePath = path.join(dir, 'tasks.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const list = JSON.parse(content) as unknown[];
      for (const item of list) {
        const validated = TaskSchema.safeParse(item);
        if (validated.success) {
          this.tasks.set(validated.data.id, validated.data);
        }
      }
    } catch (err) {
      console.warn(`Failed to load task store from '${this.filePath}':`, err);
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(this.tasks.values());
      writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to save task store to '${this.filePath}':`, err);
    }
  }

  override async createTask(task: Task): Promise<Task> {
    const res = await super.createTask(task);
    this.saveToDisk();
    return res;
  }

  override async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const res = await super.updateTask(id, updates);
    this.saveToDisk();
    return res;
  }

  override async updateStatus(
    id: string,
    newStatus: TaskStatus,
    options?: { message?: string; executor?: string; payload?: Record<string, unknown> }
  ): Promise<Task> {
    const res = await super.updateStatus(id, newStatus, options);
    this.saveToDisk();
    return res;
  }

  override async appendTimeline(
    id: string,
    event: { type: string; executor?: string; message?: string; payload?: Record<string, unknown> }
  ): Promise<Task> {
    const res = await super.appendTimeline(id, event);
    this.saveToDisk();
    return res;
  }
}

// Global default task store instance with disk persistence
export const defaultTaskStore = new FileTaskStore();
