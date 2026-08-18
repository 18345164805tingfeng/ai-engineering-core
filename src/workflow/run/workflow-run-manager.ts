import { randomUUID } from 'node:crypto';
import { Task } from '../../task/schema/task.schema.js';
import { StepResult, StepStatus } from '../schema/step.schema.js';

export interface WorkflowRun {
  runId: string;
  taskId: string;
  workflowId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  currentStep: string | null;
  steps: StepResult[];
  startedAt: string;
  endedAt?: string;
  error?: string;
  abortController: AbortController;
  metadata?: Record<string, unknown>;
}

export class WorkflowRunManager {
  private runs: Map<string, WorkflowRun> = new Map();
  private taskToRunMap: Map<string, string> = new Map();

  /**
   * 创建新的独立 Workflow Run
   */
  createRun(taskId: string, workflowId: string = 'software-development', metadata?: Record<string, unknown>): WorkflowRun {
    const runId = `RUN-${Date.now()}-${randomUUID().substring(0, 6)}`;
    const now = new Date().toISOString();

    const run: WorkflowRun = {
      runId,
      taskId,
      workflowId,
      status: 'PENDING',
      currentStep: null,
      steps: [],
      startedAt: now,
      abortController: new AbortController(),
      metadata,
    };

    this.runs.set(runId, run);
    this.taskToRunMap.set(taskId, runId);
    return run;
  }

  /**
   * 获取指定 runId 的 Run 实例
   */
  getRun(runId: string): WorkflowRun | null {
    const run = this.runs.get(runId);
    return run ? { ...run } : null;
  }

  /**
   * 获取指定 taskId 对应的当前活跃 Run 实例
   */
  getRunByTaskId(taskId: string): WorkflowRun | null {
    const runId = this.taskToRunMap.get(taskId);
    if (!runId) return null;
    return this.getRun(runId);
  }

  /**
   * 更新 Run 状态与步骤信息
   */
  updateRun(runId: string, updates: Partial<Omit<WorkflowRun, 'runId' | 'taskId' | 'abortController'>>): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`未找到 ID 为 '${runId}' 的工作流运行实例。`);
    }

    Object.assign(run, updates);
    return { ...run };
  }

  /**
   * 取消指定的 Run 实例（通过 AbortController 触发终止并更新状态）
   */
  cancelRun(runId: string, reason?: string): WorkflowRun {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`未找到 ID 为 '${runId}' 的工作流运行实例。`);
    }

    run.status = 'CANCELLED';
    run.endedAt = new Date().toISOString();
    run.error = reason || '工作流被用户手动取消';
    run.abortController.abort(reason || 'Cancelled');

    return { ...run };
  }

  /**
   * 根据 TaskId 取消 Run
   */
  cancelRunByTaskId(taskId: string, reason?: string): WorkflowRun | null {
    const runId = this.taskToRunMap.get(taskId);
    if (!runId) return null;
    return this.cancelRun(runId, reason);
  }

  /**
   * 列出所有活跃的工作流运行实例
   */
  listActiveRuns(): WorkflowRun[] {
    return Array.from(this.runs.values()).filter(
      (r) => r.status === 'RUNNING' || r.status === 'PENDING'
    );
  }

  /**
   * 列出所有历史工作流运行实例
   */
  listAllRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  /**
   * 清理已终止的 Run 记录
   */
  clear(): void {
    this.runs.clear();
    this.taskToRunMap.clear();
  }
}

export const defaultWorkflowRunManager = new WorkflowRunManager();
