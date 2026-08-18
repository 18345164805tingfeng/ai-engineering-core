export interface ProjectLockState {
  projectId: string;
  ownerTaskId: string | null;
  acquiredAt: string | null;
  waitingQueue: Array<{
    taskId: string;
    resolve: (value: boolean) => void;
    reject: (reason?: any) => void;
    timeoutTimer?: NodeJS.Timeout;
  }>;
}

export class ProjectLockManager {
  private locks: Map<string, ProjectLockState> = new Map();

  private getOrCreateLock(projectId: string): ProjectLockState {
    let state = this.locks.get(projectId);
    if (!state) {
      state = {
        projectId,
        ownerTaskId: null,
        acquiredAt: null,
        waitingQueue: [],
      };
      this.locks.set(projectId, state);
    }
    return state;
  }

  /**
   * 获取指定项目的独占工作区锁。若已被占用则异步排队等待。
   */
  async acquireLock(projectId: string, taskId: string, options?: { timeoutMs?: number }): Promise<boolean> {
    const lock = this.getOrCreateLock(projectId);

    // 1. 如果无主，直接获得锁
    if (!lock.ownerTaskId || lock.ownerTaskId === taskId) {
      lock.ownerTaskId = taskId;
      lock.acquiredAt = new Date().toISOString();
      return true;
    }

    // 2. 已被其他 Task 占用，进入排队队列
    return new Promise<boolean>((resolve, reject) => {
      let timeoutTimer: NodeJS.Timeout | undefined;

      if (options?.timeoutMs && options.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          // 超时从队列中移除
          const idx = lock.waitingQueue.findIndex((item) => item.taskId === taskId);
          if (idx !== -1) {
            lock.waitingQueue.splice(idx, 1);
          }
          reject(new Error(`等待项目 '${projectId}' 工作区锁超时（${options.timeoutMs}ms）。`));
        }, options.timeoutMs);
      }

      lock.waitingQueue.push({
        taskId,
        resolve,
        reject,
        timeoutTimer,
      });
    });
  }

  /**
   * 释放项目锁，并唤醒排队中的下一个 Task
   */
  releaseLock(projectId: string, taskId: string): boolean {
    const lock = this.locks.get(projectId);
    if (!lock) return false;

    if (lock.ownerTaskId !== taskId) {
      // 不是当前持有者，无权释放
      return false;
    }

    lock.ownerTaskId = null;
    lock.acquiredAt = null;

    // 唤醒下一个等待者
    if (lock.waitingQueue.length > 0) {
      const next = lock.waitingQueue.shift()!;
      if (next.timeoutTimer) {
        clearTimeout(next.timeoutTimer);
      }
      lock.ownerTaskId = next.taskId;
      lock.acquiredAt = new Date().toISOString();
      next.resolve(true);
    }

    return true;
  }

  /**
   * 查询项目是否处于加锁占用状态
   */
  isLocked(projectId: string): boolean {
    const lock = this.locks.get(projectId);
    return Boolean(lock && lock.ownerTaskId !== null);
  }

  /**
   * 获取当前持有锁的 TaskId
   */
  getCurrentOwner(projectId: string): string | null {
    const lock = this.locks.get(projectId);
    return lock ? lock.ownerTaskId : null;
  }

  /**
   * 获取当前正在排队的 TaskId 列表
   */
  getWaitingQueue(projectId: string): string[] {
    const lock = this.locks.get(projectId);
    return lock ? lock.waitingQueue.map((item) => item.taskId) : [];
  }

  /**
   * 清理全部锁状态
   */
  clear(): void {
    for (const lock of this.locks.values()) {
      for (const item of lock.waitingQueue) {
        if (item.timeoutTimer) clearTimeout(item.timeoutTimer);
        item.reject(new Error('ProjectLockManager has been reset'));
      }
    }
    this.locks.clear();
  }
}

export const defaultProjectLockManager = new ProjectLockManager();
