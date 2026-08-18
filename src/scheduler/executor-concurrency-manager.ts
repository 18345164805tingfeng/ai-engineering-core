export class ExecutorConcurrencyManager {
  private limits: Map<string, number> = new Map([
    ['codex', 2],
    ['antigravity', 2],
    ['ollama', 1],
    ['mock', 10],
  ]);

  private activeSlots: Map<string, Set<string>> = new Map();
  private waitQueue: Map<
    string,
    Array<{
      taskId: string;
      resolve: (value: boolean) => void;
      reject: (reason?: any) => void;
      timeoutTimer?: NodeJS.Timeout;
    }>
  > = new Map();

  /**
   * 设置执行器的最大并发上限
   */
  setLimit(executorId: string, limit: number): void {
    this.limits.set(executorId, limit);
  }

  /**
   * 获取执行器当前配置的最大并发数
   */
  getLimit(executorId: string): number {
    return this.limits.get(executorId) ?? 2;
  }

  /**
   * 获取执行器当前已占用的槽位数
   */
  getActiveCount(executorId: string): number {
    const active = this.activeSlots.get(executorId);
    return active ? active.size : 0;
  }

  /**
   * 申请指定执行器的并发槽位
   */
  async acquireSlot(executorId: string, taskId: string, options?: { timeoutMs?: number }): Promise<boolean> {
    const limit = this.getLimit(executorId);
    let active = this.activeSlots.get(executorId);
    if (!active) {
      active = new Set();
      this.activeSlots.set(executorId, active);
    }

    if (active.size < limit || active.has(taskId)) {
      active.add(taskId);
      return true;
    }

    // 槽位已满，进入排队
    let queue = this.waitQueue.get(executorId);
    if (!queue) {
      queue = [];
      this.waitQueue.set(executorId, queue);
    }

    return new Promise<boolean>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | undefined;

      if (options?.timeoutMs && options.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          const q = this.waitQueue.get(executorId);
          if (q) {
            const idx = q.findIndex((item) => item.taskId === taskId);
            if (idx !== -1) q.splice(idx, 1);
          }
          reject(new Error(`等待执行器 '${executorId}' 并发槽位超时（${options.timeoutMs}ms）。`));
        }, options.timeoutMs);
      }

      queue!.push({ taskId, resolve, reject, timeoutTimer });
    });
  }

  /**
   * 释放指定执行器的并发槽位并唤醒等待者
   */
  releaseSlot(executorId: string, taskId: string): void {
    const active = this.activeSlots.get(executorId);
    if (active) {
      active.delete(taskId);
    }

    const queue = this.waitQueue.get(executorId);
    if (queue && queue.length > 0) {
      const limit = this.getLimit(executorId);
      const curSize = active ? active.size : 0;

      if (curSize < limit) {
        const next = queue.shift()!;
        if (next.timeoutTimer) clearTimeout(next.timeoutTimer);
        if (active) active.add(next.taskId);
        next.resolve(true);
      }
    }
  }

  /**
   * 清理全部状态
   */
  clear(): void {
    this.activeSlots.clear();
    for (const q of this.waitQueue.values()) {
      for (const item of q) {
        if (item.timeoutTimer) clearTimeout(item.timeoutTimer);
        item.reject(new Error('ExecutorConcurrencyManager has been reset'));
      }
    }
    this.waitQueue.clear();
  }
}

export const defaultExecutorConcurrencyManager = new ExecutorConcurrencyManager();
