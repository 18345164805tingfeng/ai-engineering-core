import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Task, TaskSchema } from '../schema/task.schema.js';
import { TimelineEvent } from '../schema/timeline.schema.js';
import { TaskStatus, validateStatusTransition } from '../state/task-state.js';
import { SecretRedactor } from '../../security/secret-redactor.js';

export class ConcurrencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

export interface ITaskStore {
  createTask(task: Task): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, updates: Partial<Task>, expectedUpdatedAt?: string): Promise<Task>;
  updateStatus(
    id: string,
    newStatus: TaskStatus,
    options?: {
      message?: string;
      summary?: string;
      executor?: string;
      artifactId?: string;
      data?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  ): Promise<Task>;
  appendTimeline(
    id: string,
    event: {
      type: string;
      executor?: string;
      message?: string;
      summary?: string;
      artifactId?: string;
      data?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  ): Promise<Task>;
  listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]>;
}

export class InMemoryTaskStore implements ITaskStore {
  protected tasks: Map<string, Task> = new Map();

  protected generateNextTimestamp(existingTimestamp?: string): string {
    const nowMs = Date.now();
    if (existingTimestamp) {
      const prevMs = new Date(existingTimestamp).getTime();
      if (nowMs <= prevMs) {
        return new Date(prevMs + 1).toISOString();
      }
    }
    return new Date(nowMs).toISOString();
  }

  async createTask(taskData: Task): Promise<Task> {
    const redactedData = SecretRedactor.redactObject(taskData);
    const validated = TaskSchema.parse(redactedData);
    if (this.tasks.has(validated.id)) {
      throw new Error(`任务创建失败：ID 为 '${validated.id}' 的任务已存在。`);
    }

    const now = new Date().toISOString();
    const task: Task = {
      ...validated,
      createdAt: validated.createdAt || now,
      updatedAt: now,
    };

    // 自动记录初始任务创建事件
    if (task.timeline.length === 0) {
      task.timeline.push({
        id: randomUUID(),
        type: 'TASK_CREATED',
        timestamp: now,
        summary: `任务 ${task.id} 已创建`,
        message: `任务 ${task.id} 已创建，初始状态为 ${task.status}`,
        data: {
          projectId: task.project.id,
          source: task.source.type,
          status: task.status,
        },
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

  async updateTask(id: string, updates: Partial<Task>, expectedUpdatedAt?: string): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`更新失败：未找到 ID 为 '${id}' 的任务。`);
    }

    // 乐观并发版本检查
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      throw new ConcurrencyConflictError(
        `【并发冲突】任务 '${id}' 状态已被并发修改（当前更新时间：'${existing.updatedAt}'，提交修改基线：'${expectedUpdatedAt}'）。`
      );
    }

    if (updates.status && updates.status !== existing.status) {
      validateStatusTransition(existing.status, updates.status);
    }

    const redactedUpdates = SecretRedactor.redactObject(updates);
    const nextUpdatedAt = this.generateNextTimestamp(existing.updatedAt);
    const merged: Task = {
      ...existing,
      ...redactedUpdates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: nextUpdatedAt,
    };

    const validated = TaskSchema.parse(merged);
    this.tasks.set(id, validated);
    return structuredClone(validated);
  }

  async updateStatus(
    id: string,
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
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`状态更新失败：未找到 ID 为 '${id}' 的任务。`);
    }

    validateStatusTransition(existing.status, newStatus);

    const nextUpdatedAt = this.generateNextTimestamp(existing.updatedAt);
    const mergedPayload = SecretRedactor.redactObject({
      previousStatus: existing.status,
      newStatus,
      ...(options?.data || {}),
      ...(options?.payload || {}),
    });

    const timelineEvent: TimelineEvent = {
      id: randomUUID(),
      type: 'STATUS_CHANGED',
      timestamp: nextUpdatedAt,
      executor: options?.executor,
      summary: options?.summary || `状态流转：${existing.status} -> ${newStatus}`,
      message: options?.message || `任务状态由 ${existing.status} 变更为 ${newStatus}`,
      artifactId: options?.artifactId,
      data: mergedPayload as Record<string, unknown>,
      payload: mergedPayload as Record<string, unknown>,
    };

    const updated: Task = {
      ...existing,
      status: newStatus,
      updatedAt: nextUpdatedAt,
      timeline: [...existing.timeline, timelineEvent],
    };

    const validated = TaskSchema.parse(updated);
    this.tasks.set(id, validated);
    return structuredClone(validated);
  }

  async appendTimeline(
    id: string,
    event: {
      type: string;
      executor?: string;
      message?: string;
      summary?: string;
      artifactId?: string;
      data?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  ): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`时间线追加失败：未找到 ID 为 '${id}' 的任务。`);
    }

    const nextUpdatedAt = this.generateNextTimestamp(existing.updatedAt);
    const eventData = SecretRedactor.redactObject(event.data || event.payload || {});

    const timelineEvent: TimelineEvent = {
      id: randomUUID(),
      type: event.type,
      timestamp: nextUpdatedAt,
      executor: event.executor,
      summary: event.summary,
      message: event.message,
      artifactId: event.artifactId,
      data: eventData as Record<string, unknown>,
      payload: eventData as Record<string, unknown>,
    };

    const updated: Task = {
      ...existing,
      updatedAt: nextUpdatedAt,
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
      const raw = readFileSync(this.filePath, 'utf-8');
      const content = raw ? raw.trim() : '';
      if (!content) return;

      const list = JSON.parse(content) as unknown[];
      if (Array.isArray(list)) {
        for (const item of list) {
          const validated = TaskSchema.safeParse(item);
          if (validated.success) {
            this.tasks.set(validated.data.id, validated.data);
          }
        }
      }
    } catch (err) {
      console.warn(`[任务存储] 从 '${this.filePath}' 加载数据失败:`, err);
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
      console.error(`[任务存储] 持久化保存至 '${this.filePath}' 失败:`, err);
    }
  }

  override async createTask(task: Task): Promise<Task> {
    const res = await super.createTask(task);
    this.saveToDisk();
    return res;
  }

  override async updateTask(id: string, updates: Partial<Task>, expectedUpdatedAt?: string): Promise<Task> {
    const res = await super.updateTask(id, updates, expectedUpdatedAt);
    this.saveToDisk();
    return res;
  }

  override async updateStatus(
    id: string,
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
    const res = await super.updateStatus(id, newStatus, options);
    this.saveToDisk();
    return res;
  }

  override async appendTimeline(
    id: string,
    event: {
      type: string;
      executor?: string;
      message?: string;
      summary?: string;
      artifactId?: string;
      data?: Record<string, unknown>;
      payload?: Record<string, unknown>;
    }
  ): Promise<Task> {
    const res = await super.appendTimeline(id, event);
    this.saveToDisk();
    return res;
  }
}

// 全局默认持久化任务存储实例
export const defaultTaskStore = new FileTaskStore();
