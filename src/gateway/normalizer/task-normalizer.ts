import { Task, TaskSchema } from '../../task/schema/task.schema.js';
import { RawExternalTask } from '../sources/task-source.js';
import { randomBytes } from 'node:crypto';

export class TaskNormalizer {
  private static generateTaskId(): string {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const randomSuffix = randomBytes(2).toString('hex').toUpperCase();
    return `TASK-${yyyy}${mm}${dd}-${randomSuffix}`;
  }

  static normalize(raw: RawExternalTask, options?: { taskId?: string }): Task {
    const now = new Date().toISOString();
    const taskId = options?.taskId || this.generateTaskId();

    const taskData: Task = {
      id: taskId,
      source: {
        type: raw.sourceType,
        externalId: raw.externalId,
        sync: raw.sourceType !== 'manual',
        metadata: raw.metadata,
      },
      project: {
        id: raw.project.id,
        root: raw.project.root,
      },
      requirement: {
        title: raw.requirement.title,
        description: raw.requirement.description || '',
        constraints: raw.requirement.constraints || [],
      },
      priority: raw.priority || 'normal',
      mode: raw.mode || 'auto',
      status: 'CREATED',
      analysis: {
        type: null,
        complexity: null,
        risk: null,
      },
      plan: null,
      execution: {
        round: 0,
        changes: [],
      },
      verification: {
        results: [],
      },
      review: {
        round: 0,
        result: null,
        issues: [],
      },
      arbitration: null,
      timeline: [],
      createdAt: now,
      updatedAt: now,
    };

    return TaskSchema.parse(taskData);
  }
}
