export class WorkflowScheduler {
  private maxConcurrentRuns: number = 4;
  private activeRuns: Set<string> = new Set();
  private queue: Array<{
    taskId: string;
    runId: string;
    runFn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];

  constructor(maxConcurrentRuns: number = 4) {
    this.maxConcurrentRuns = maxConcurrentRuns;
  }

  setMaxConcurrentRuns(max: number): void {
    this.maxConcurrentRuns = max;
    this.processQueue();
  }

  getMaxConcurrentRuns(): number {
    return this.maxConcurrentRuns;
  }

  getActiveCount(): number {
    return this.activeRuns.size;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  /**
   * 调度执行一个工作流运行任务
   */
  async schedule<T>(taskId: string, runId: string, runFn: () => Promise<T>): Promise<T> {
    if (this.activeRuns.size < this.maxConcurrentRuns) {
      return this.executeRun(taskId, runId, runFn);
    }

    // 超过全局并发上限，进入 FIFO 队列排队
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        taskId,
        runId,
        runFn,
        resolve,
        reject,
      });
    });
  }

  private async executeRun<T>(taskId: string, runId: string, runFn: () => Promise<T>): Promise<T> {
    this.activeRuns.add(runId);
    try {
      return await runFn();
    } finally {
      this.activeRuns.delete(runId);
      this.processQueue();
    }
  }

  private processQueue(): void {
    while (this.activeRuns.size < this.maxConcurrentRuns && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.executeRun(next.taskId, next.runId, next.runFn)
        .then(next.resolve)
        .catch(next.reject);
    }
  }

  clear(): void {
    this.activeRuns.clear();
    for (const item of this.queue) {
      item.reject(new Error('WorkflowScheduler has been reset'));
    }
    this.queue = [];
  }
}

export const defaultWorkflowScheduler = new WorkflowScheduler();
