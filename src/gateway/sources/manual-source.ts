import { ITaskSource, RawExternalTask } from './task-source.js';

export interface ManualTaskInput {
  project?: string | { id: string; root?: string };
  projectId?: string;
  requirement?:
    | string
    | {
        title: string;
        description?: string;
        constraints?: string[];
      };
  title?: string;
  description?: string;
  constraints?: string[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  mode?: 'fast' | 'standard' | 'strict' | 'auto';
  metadata?: Record<string, unknown>;
}

export class ManualSource implements ITaskSource {
  readonly sourceType = 'manual' as const;

  createRawTask(input: ManualTaskInput, externalId?: string): RawExternalTask {
    const proj = input.project || input.projectId || 'demo';
    const project = typeof proj === 'string' ? { id: proj } : proj;

    let requirement: { title: string; description: string; constraints: string[] };
    if (typeof input.requirement === 'string') {
      requirement = {
        title: input.requirement,
        description: input.description || '',
        constraints: input.constraints || [],
      };
    } else if (input.requirement && typeof input.requirement === 'object') {
      requirement = {
        title: input.requirement.title,
        description: input.requirement.description || input.description || '',
        constraints: input.requirement.constraints || input.constraints || [],
      };
    } else {
      requirement = {
        title: input.title || 'Untitled Task',
        description: input.description || '',
        constraints: input.constraints || [],
      };
    }

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
