import { TaskSource as TaskSourceType } from '../../task/schema/task.schema.js';

export interface RawExternalTask {
  externalId: string;
  sourceType: TaskSourceType['type'];
  project: {
    id: string;
    root?: string;
  };
  requirement: {
    title: string;
    description?: string;
    constraints?: string[];
  };
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  mode?: 'fast' | 'standard' | 'strict' | 'auto';
  metadata?: Record<string, unknown>;
}

export interface ITaskSource {
  readonly sourceType: TaskSourceType['type'];
  fetchPendingTasks?(): Promise<RawExternalTask[]>;
  getTask?(externalId: string): Promise<RawExternalTask | null>;
  updateStatus?(externalId: string, status: string): Promise<void>;
  postResult?(externalId: string, result: unknown): Promise<void>;
}
