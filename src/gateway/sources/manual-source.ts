import { ITaskSource, RawExternalTask } from './task-source.js';

export interface ManualTaskInput {
  project: string | { id: string; root?: string };
  requirement:
    | string
    | {
        title: string;
        description?: string;
        constraints?: string[];
      };
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  mode?: 'fast' | 'standard' | 'strict' | 'auto';
  metadata?: Record<string, unknown>;
}

export class ManualSource implements ITaskSource {
  readonly sourceType = 'manual' as const;

  createRawTask(input: ManualTaskInput, externalId?: string): RawExternalTask {
    const project = typeof input.project === 'string' ? { id: input.project } : input.project;
    const requirement =
      typeof input.requirement === 'string'
        ? { title: input.requirement, description: '', constraints: [] }
        : {
            title: input.requirement.title,
            description: input.requirement.description || '',
            constraints: input.requirement.constraints || [],
          };

    return {
      externalId: externalId || `manual-${Date.now()}`,
      sourceType: this.sourceType,
      project,
      requirement,
      priority: input.priority || 'normal',
      mode: input.mode || 'auto',
      metadata: input.metadata,
    };
  }
}
