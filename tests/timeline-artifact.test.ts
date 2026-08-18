import { describe, it, expect, beforeEach } from 'vitest';
import { ArtifactStore } from '../src/task/artifact/artifact-store.js';
import { InMemoryTaskStore } from '../src/task/store/task-store.js';
import { InternalTask } from '../src/task/schema/task.schema.js';

describe('Timeline Audit & Artifact Store', () => {
  let artifactStore: ArtifactStore;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    artifactStore = new ArtifactStore();
    taskStore = new InMemoryTaskStore();
  });

  it('ArtifactStore should create and retrieve artifacts with automatic secret redaction', async () => {
    const artifact = await artifactStore.createArtifact({
      taskId: 'TASK-100',
      type: 'test_log',
      data: {
        command: 'npm test',
        output: 'Token: sk-proj-12345678901234567890\nTests passed',
      },
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.taskId).toBe('TASK-100');
    expect(artifact.type).toBe('test_log');

    const retrieved = await artifactStore.getArtifact(artifact.id);
    expect(retrieved).not.toBeNull();
    const data = retrieved?.data as any;
    expect(data.output).toContain('[REDACTED]');
    expect(data.output).not.toContain('sk-proj-12345678901234567890');
  });

  it('ArtifactStore should list artifacts by taskId', async () => {
    await artifactStore.createArtifact({ taskId: 'TASK-1', type: 'plan', data: {} });
    await artifactStore.createArtifact({ taskId: 'TASK-1', type: 'review', data: {} });
    await artifactStore.createArtifact({ taskId: 'TASK-2', type: 'test', data: {} });

    const task1Arts = await artifactStore.listArtifacts('TASK-1');
    expect(task1Arts.length).toBe(2);
    expect(task1Arts.map((a) => a.type)).toEqual(['plan', 'review']);
  });

  it('Timeline events should record audit summaries and artifact references without bloating payload', async () => {
    const nowIso = new Date().toISOString();
    const task: InternalTask = {
      id: 'TASK-AUDIT-1',
      source: { type: 'manual', externalId: null, sync: false },
      project: { id: 'demo' },
      requirement: { title: 'Audit test', description: '', constraints: [] },
      priority: 'normal',
      mode: 'auto',
      status: 'CREATED',
      analysis: {},
      plan: null,
      execution: { round: 0, changes: [] },
      verification: { results: [] },
      review: { round: 0, result: null, issues: [] },
      arbitration: null,
      timeline: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await taskStore.createTask(task);

    const art = await artifactStore.createArtifact({
      taskId: task.id,
      type: 'test_log',
      data: { stdout: 'Full massive log with thousands of lines...' },
    });

    await taskStore.appendTimeline(task.id, {
      type: 'verification.completed',
      summary: 'Verification passed (ExitCode: 0)',
      artifactId: art.id,
      data: {
        success: true,
        exitCode: 0,
        durationMs: 1420,
      },
    });

    const updatedTask = await taskStore.getTask(task.id);
    expect(updatedTask).not.toBeNull();
    const lastEvent = updatedTask!.timeline[updatedTask!.timeline.length - 1];

    expect(lastEvent.type).toBe('verification.completed');
    expect(lastEvent.artifactId).toBe(art.id);
    expect(lastEvent.summary).toBe('Verification passed (ExitCode: 0)');
    expect(lastEvent.data?.durationMs).toBe(1420);
    // Huge stdout is stored in artifact, not in timeline
    expect(lastEvent.data?.stdout).toBeUndefined();
  });
});
