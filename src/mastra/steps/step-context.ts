import { InternalTask } from '../../task/schema/task.schema.js';
import { StepResult, StepStatus } from '../../workflow/schema/step.schema.js';
import { defaultTaskStore } from '../../task/store/task-store.js';

export interface StepExecutionOutcome {
  status: StepStatus;
  summary?: string;
  executor?: string;
  model?: string;
  artifactIds?: string[];
  data?: Record<string, unknown>;
  error?: string;
}

export async function executeTrackedStep<T extends StepExecutionOutcome>(
  task: InternalTask,
  stepId: string,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = new Date().toISOString();
  task.workflow = {
    ...task.workflow,
    currentStep: stepId,
  };

  try {
    const outcome = await fn();
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

    const stepResult: StepResult = {
      id: stepId,
      status: outcome.status,
      startedAt,
      endedAt,
      durationMs,
      executor: outcome.executor,
      model: outcome.model,
      summary: outcome.summary,
      artifactIds: outcome.artifactIds || [],
      error: outcome.error,
      data: outcome.data,
    };

    task.steps.push(stepResult);
    await defaultTaskStore.updateTask(task.id, {
      workflow: task.workflow,
      steps: task.steps,
    }).catch(() => {});

    return outcome;
  } catch (err) {
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    const errorMsg = err instanceof Error ? err.message : String(err);

    const failedResult: StepResult = {
      id: stepId,
      status: 'FAILED',
      startedAt,
      endedAt,
      durationMs,
      error: errorMsg,
      artifactIds: [],
    };

    task.steps.push(failedResult);
    await defaultTaskStore.updateTask(task.id, {
      workflow: task.workflow,
      steps: task.steps,
    }).catch(() => {});

    throw err;
  }
}
