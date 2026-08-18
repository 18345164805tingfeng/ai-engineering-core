import { TaskWorkspace } from '../workflow/schema/step.schema.js';
import { defaultProjectLockManager, ProjectLockManager } from './project-lock-manager.js';

export interface WorkspaceConfig {
  mode?: 'shared-lock' | 'git-worktree';
}

export class WorkspaceManager {
  private lockManager: ProjectLockManager;
  private workspaces: Map<string, TaskWorkspace> = new Map();

  constructor(lockManager: ProjectLockManager = defaultProjectLockManager) {
    this.lockManager = lockManager;
  }

  /**
   * 申请并分配工作区（在 shared-lock 模式下会自动获取项目排他锁）
   */
  async acquireWorkspace(
    project: { id: string; root?: string },
    taskId: string,
    options?: { timeoutMs?: number; mode?: 'shared-lock' | 'git-worktree' }
  ): Promise<TaskWorkspace> {
    const mode = options?.mode || 'shared-lock';

    if (mode === 'shared-lock') {
      await this.lockManager.acquireLock(project.id, taskId, {
        timeoutMs: options?.timeoutMs,
      });
    }

    const workspace: TaskWorkspace = {
      id: `ws-${project.id}-${taskId}`,
      mode,
      root: project.root || null,
      branch: 'main',
      baseBranch: 'main',
    };

    this.workspaces.set(taskId, workspace);
    return { ...workspace };
  }

  /**
   * 释放工作区与项目排他锁
   */
  async releaseWorkspace(projectId: string, taskId: string): Promise<void> {
    this.workspaces.delete(taskId);
    this.lockManager.releaseLock(projectId, taskId);
  }

  /**
   * 获取指定 Task 对应的工作区
   */
  getWorkspace(taskId: string): TaskWorkspace | null {
    const ws = this.workspaces.get(taskId);
    return ws ? { ...ws } : null;
  }

  /**
   * 清理工作区状态
   */
  clear(): void {
    this.workspaces.clear();
    this.lockManager.clear();
  }
}

export const defaultWorkspaceManager = new WorkspaceManager();
