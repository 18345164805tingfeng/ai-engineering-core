import { z } from 'zod';
import { SecretRedactor } from '../../security/secret-redactor.js';

export const ArtifactSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  type: z.string(),
  data: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export interface CreateArtifactInput {
  taskId: string;
  type: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export interface IArtifactStore {
  createArtifact(input: CreateArtifactInput): Promise<Artifact>;
  getArtifact(artifactId: string): Promise<Artifact | null>;
  listArtifacts(taskId: string): Promise<Artifact[]>;
  clear(): Promise<void>;
}

export class ArtifactStore implements IArtifactStore {
  private artifacts: Map<string, Artifact> = new Map();

  async createArtifact(input: CreateArtifactInput): Promise<Artifact> {
    const id = `ART-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const sanitizedData = SecretRedactor.redactObject(input.data);
    const sanitizedMeta = input.metadata ? SecretRedactor.redactObject(input.metadata) : undefined;

    const artifact: Artifact = {
      id,
      taskId: input.taskId,
      type: input.type,
      data: sanitizedData,
      metadata: sanitizedMeta,
      createdAt: new Date().toISOString(),
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  async getArtifact(artifactId: string): Promise<Artifact | null> {
    const found = this.artifacts.get(artifactId);
    return found ? { ...found } : null;
  }

  async listArtifacts(taskId: string): Promise<Artifact[]> {
    const results: Artifact[] = [];
    for (const art of this.artifacts.values()) {
      if (art.taskId === taskId) {
        results.push({ ...art });
      }
    }
    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async clear(): Promise<void> {
    this.artifacts.clear();
  }
}

export const defaultArtifactStore = new ArtifactStore();
