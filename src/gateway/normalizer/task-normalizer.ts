import { Task, TaskSchema } from '../../task/schema/task.schema.js';
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

  static normalize(raw: any, options?: { taskId?: string }): Task {
    const now = new Date().toISOString();
    const taskId = options?.taskId || this.generateTaskId();

    const sourceType = raw.sourceType || raw.source?.type || 'manual';
    const externalId = raw.externalId || raw.source?.externalId || null;
    const metadata = raw.metadata || raw.source?.metadata;

    let project: { id: string; root?: string };
    if (typeof raw.project === 'string') {
      project = { id: raw.project };
    } else if (raw.project?.id) {
      project = { id: raw.project.id, root: raw.project.root };
    } else {
      project = { id: raw.projectId || 'demo' };
    }

    let requirement: { title: string; description: string; constraints: string[] };
    if (typeof raw.requirement === 'string') {
      requirement = {
        title: raw.requirement,
        description: raw.description || '',
        constraints: raw.constraints || [],
      };
    } else if (raw.requirement && typeof raw.requirement === 'object') {
      requirement = {
        title: raw.requirement.title || raw.title || 'Untitled Task',
        description: raw.requirement.description || raw.description || '',
        constraints: raw.requirement.constraints || raw.constraints || [],
      };
    } else {
      requirement = {
        title: raw.title || 'Untitled Task',
        description: raw.description || '',
        constraints: raw.constraints || [],
      };
    }

    const taskData = {
      id: taskId,
      source: {
        type: sourceType,
        externalId,
        sync: sourceType !== 'manual',
        metadata,
      },
      project,
      requirement,
      priority: raw.priority || 'normal',
      mode: raw.mode || 'auto',
      status: 'CREATED' as const,
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
      workflow: raw.workflow || {
        workflowId: 'software-development',
        runId: null,
        currentStep: null,
      },
      steps: raw.steps || [],
      workspace: raw.workspace || {
        id: null,
        mode: 'shared-lock' as const,
        root: project.root || null,
        branch: null,
        baseBranch: null,
      },
      scheduling: raw.scheduling || {
        status: 'READY' as const,
        queuedAt: null,
        startedAt: null,
        waitingReason: null,
      },
      createdAt: now,
      updatedAt: now,
    };

    return TaskSchema.parse(taskData);
  }
}
