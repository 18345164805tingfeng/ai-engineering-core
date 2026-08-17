import { describe, it, expect, beforeEach } from 'vitest';
import {
  TaskGateway,
  InMemoryTaskStore,
  canTransition,
  validateStatusTransition,
  TaskSchema,
  ReviewIssueSchema,
  defaultTaskGateway,
} from '../src/index.js';

describe('Phase 1: Task Core & Task Gateway', () => {
  let store: InMemoryTaskStore;
  let gateway: TaskGateway;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    gateway = new TaskGateway(store);
  });

  describe('Task Schema & Validation', () => {
    it('should validate a complete Task structure with zod', () => {
      const sampleTask = {
        id: 'TASK-20260817-001',
        source: {
          type: 'manual' as const,
          externalId: null,
          sync: false,
        },
        project: {
          id: 'bi',
          root: 'D:/workspace/bi',
        },
        requirement: {
          title: '增加用户删除功能',
          description: '支持管理员软删除用户',
          constraints: ['需要二次确认'],
        },
        priority: 'normal' as const,
        mode: 'standard' as const,
        status: 'CREATED' as const,
        analysis: {
          type: 'feature',
          complexity: 'low' as const,
          risk: 'low' as const,
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const parsed = TaskSchema.parse(sampleTask);
      expect(parsed.id).toBe('TASK-20260817-001');
      expect(parsed.status).toBe('CREATED');
      expect(parsed.priority).toBe('normal');
    });

    it('should validate structured Review Issue', () => {
      const sampleIssue = {
        id: 'ISSUE-001',
        severity: 'high' as const,
        category: 'correctness' as const,
        file: 'src/user/service.ts',
        location: 'deleteUser',
        description: '删除前未检查关联数据',
        evidence: 'await db.user.delete() 没有前置关联查询',
        suggestion: '增加关联数据检查',
      };

      const parsed = ReviewIssueSchema.parse(sampleIssue);
      expect(parsed.id).toBe('ISSUE-001');
      expect(parsed.severity).toBe('high');
      expect(parsed.category).toBe('correctness');
    });
  });

  describe('Task State Machine', () => {
    it('should allow valid status transitions', () => {
      expect(canTransition('CREATED', 'LOADING_CONTEXT')).toBe(true);
      expect(canTransition('LOADING_CONTEXT', 'ANALYZING')).toBe(true);
      expect(canTransition('ANALYZING', 'PLANNING')).toBe(true);
      expect(canTransition('PLANNING', 'CODING')).toBe(true);
      expect(canTransition('CODING', 'VERIFYING')).toBe(true);
      expect(canTransition('VERIFYING', 'REVIEWING')).toBe(true);
      expect(canTransition('REVIEWING', 'FIXING')).toBe(true);
      expect(canTransition('FIXING', 'VERIFYING')).toBe(true);
      expect(canTransition('REVIEWING', 'FINALIZING')).toBe(true);
      expect(canTransition('FINALIZING', 'DONE')).toBe(true);
    });

    it('should block invalid status transitions and throw error on validateStatusTransition', () => {
      expect(canTransition('CREATED', 'DONE')).toBe(false);
      expect(canTransition('DONE', 'CODING')).toBe(false);
      expect(canTransition('CODING', 'DONE')).toBe(false);

      expect(() => validateStatusTransition('CREATED', 'DONE')).toThrow(
        /Invalid task status transition/
      );
    });
  });

  describe('Task Gateway & Manual Source Submission', () => {
    it('should submit a manual task and persist in store with initial timeline event', async () => {
      const task = await gateway.submitManualTask({
        project: 'demo',
        requirement: {
          title: '增加用户删除功能',
          description: '实现软删除接口',
        },
        priority: 'high',
        mode: 'standard',
      });

      expect(task).toBeDefined();
      expect(task.id).toMatch(/^TASK-\d{8}-[A-F0-9]{4}$/);
      expect(task.project.id).toBe('demo');
      expect(task.requirement.title).toBe('增加用户删除功能');
      expect(task.priority).toBe('high');
      expect(task.mode).toBe('standard');
      expect(task.status).toBe('CREATED');
      expect(task.timeline.length).toBe(1);
      expect(task.timeline[0]?.type).toBe('TASK_CREATED');

      const retrieved = await gateway.getTask(task.id);
      expect(retrieved).toEqual(task);
    });

    it('should support string-based requirement shorthand', async () => {
      const task = await gateway.submitManualTask({
        project: 'bi',
        requirement: '修复图表渲染 bug',
      });

      expect(task.requirement.title).toBe('修复图表渲染 bug');
      expect(task.priority).toBe('normal');
      expect(task.mode).toBe('auto');
    });

    it('should update status through the gateway and automatically log timeline events', async () => {
      const task = await gateway.submitManualTask({
        project: 'demo',
        requirement: '测试工作流状态流转',
      });

      const updatedToLoading = await gateway.updateTaskStatus(task.id, 'LOADING_CONTEXT', {
        executor: 'context-loader',
        message: '开始加载项目配置',
      });
      expect(updatedToLoading.status).toBe('LOADING_CONTEXT');
      expect(updatedToLoading.timeline.length).toBe(2);
      expect(updatedToLoading.timeline[1]?.type).toBe('STATUS_CHANGED');
      expect(updatedToLoading.timeline[1]?.executor).toBe('context-loader');

      const updatedToAnalyzing = await gateway.updateTaskStatus(task.id, 'ANALYZING');
      expect(updatedToAnalyzing.status).toBe('ANALYZING');
      expect(updatedToAnalyzing.timeline.length).toBe(3);

      const timeline = await gateway.getTimeline(task.id);
      expect(timeline.length).toBe(3);
    });

    it('should cancel a task successfully', async () => {
      const task = await gateway.submitManualTask({
        project: 'demo',
        requirement: '需要取消的任务',
      });

      const cancelled = await gateway.cancelTask(task.id, '用户手动终止');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.timeline.at(-1)?.message).toBe('用户手动终止');
    });

    it('should list tasks with filter', async () => {
      await gateway.submitManualTask({ project: 'p1', requirement: 'Task 1' });
      const task2 = await gateway.submitManualTask({ project: 'p2', requirement: 'Task 2' });
      await gateway.updateTaskStatus(task2.id, 'LOADING_CONTEXT');

      const p1Tasks = await gateway.listTasks({ projectId: 'p1' });
      expect(p1Tasks.length).toBe(1);
      expect(p1Tasks[0]?.project.id).toBe('p1');

      const loadingTasks = await gateway.listTasks({ status: 'LOADING_CONTEXT' });
      expect(loadingTasks.length).toBe(1);
      expect(loadingTasks[0]?.id).toBe(task2.id);
    });
  });

  describe('Default Singleton TaskGateway', () => {
    it('should have defaultTaskGateway ready for usage', () => {
      expect(defaultTaskGateway).toBeDefined();
    });
  });
});
