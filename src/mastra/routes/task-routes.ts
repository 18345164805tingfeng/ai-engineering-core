import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { defaultTaskGateway, TaskGateway } from '../../gateway/task-gateway.js';
import { SecretRedactor } from '../../security/secret-redactor.js';
import { defaultProjectResolver } from '../../project/project-resolver.js';
import { ContextLoader } from '../../project/context-loader.js';
import { executeSoftwareDevelopmentLoop } from '../workflows/software-development.js';
import { TaskStatus } from '../../task/state/task-state.js';

export interface TaskRouteContext {
  req?: {
    json?: () => Promise<any>;
    param?: (key: string) => string;
    query?: (key: string) => string;
    url?: string;
  };
  json?: (data: any, status?: number) => Response;
  html?: (html: string, status?: number) => Response;
  params?: Record<string, string>;
  body?: any;
}

export class TaskApiController {
  private gateway: TaskGateway;

  constructor(gateway: TaskGateway = defaultTaskGateway) {
    this.gateway = gateway;
  }

  /**
   * GET /tasks
   */
  async listTasks(query?: { status?: TaskStatus; projectId?: string }): Promise<{ status: number; data: any }> {
    try {
      const list = await this.gateway.listTasks(query);
      const sanitized = SecretRedactor.redactObject(list);
      return { status: 200, data: sanitized };
    } catch (err) {
      return {
        status: 500,
        data: { error: `获取任务列表失败：${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  /**
   * POST /tasks
   */
  async createTask(body: any): Promise<{ status: number; data: any }> {
    try {
      if (!body) {
        return { status: 400, data: { error: '请求体（Request Body）不能为空。' } };
      }

      let projectId = 'demo';
      if (typeof body.project === 'string') {
        projectId = body.project;
      } else if (body.project?.id) {
        projectId = body.project.id;
      } else if (body.projectId) {
        projectId = body.projectId;
      }

      let requirementTitle = '';
      let requirementDesc = '';
      let constraints: string[] = [];

      if (typeof body.requirement === 'string') {
        requirementTitle = body.requirement;
      } else if (body.requirement?.title) {
        requirementTitle = body.requirement.title;
        requirementDesc = body.requirement.description || '';
        constraints = body.requirement.constraints || [];
      } else if (body.title) {
        requirementTitle = body.title;
        requirementDesc = body.description || '';
        constraints = body.constraints || [];
      } else {
        return { status: 400, data: { error: '需求标题（title）或描述（description）不能为空。' } };
      }

      const task = await this.gateway.submitManualTask({
        project: projectId,
        requirement: {
          title: requirementTitle,
          description: requirementDesc,
          constraints,
        },
        priority: body.priority || 'normal',
        mode: body.mode || 'auto',
      });

      // 异步唤起软件开发工作流
      if (body.triggerWorkflow !== false) {
        try {
          defaultProjectResolver.loadConfig();
          const resolved = defaultProjectResolver.resolveProject(projectId);
          const projectContext = ContextLoader.loadContext(resolved);

          executeSoftwareDevelopmentLoop(task, projectContext).catch((err) => {
            console.error(`[工作流调度异常] 任务 '${task.id}' 异步执行错误:`, err);
          });
        } catch (err) {
          console.warn(`[工作流调度告警] 无法为任务 '${task.id}' 自动触发工作流:`, err);
        }
      }

      return {
        status: 201,
        data: {
          taskId: task.id,
          status: task.status,
          message: '任务创建成功并已加入编排执行流水线。',
          createdAt: task.createdAt,
        },
      };
    } catch (err) {
      const sanitized = SecretRedactor.redactError(err);
      return {
        status: 500,
        data: { error: `任务创建异常：${sanitized instanceof Error ? sanitized.message : String(sanitized)}` },
      };
    }
  }

  /**
   * GET /tasks/:id
   */
  async getTask(taskId: string): Promise<{ status: number; data: any }> {
    try {
      if (!taskId) {
        return { status: 400, data: { error: '任务 ID（taskId）不能为空。' } };
      }

      const task = await this.gateway.getTask(taskId);
      if (!task) {
        return { status: 404, data: { error: `未找到 ID 为 '${taskId}' 的任务。` } };
      }

      const sanitized = SecretRedactor.redactObject(task);
      return { status: 200, data: sanitized };
    } catch (err) {
      return {
        status: 500,
        data: { error: `查询任务失败：${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  /**
   * GET /tasks/:id/timeline
   */
  async getTimeline(taskId: string): Promise<{ status: number; data: any }> {
    try {
      if (!taskId) {
        return { status: 400, data: { error: '任务 ID（taskId）不能为空。' } };
      }

      const timeline = await this.gateway.getTimeline(taskId);
      const sanitized = SecretRedactor.redactObject(timeline);
      return { status: 200, data: sanitized };
    } catch (err) {
      return {
        status: 404,
        data: { error: `获取时间线失败：${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  /**
   * POST /tasks/:id/cancel
   */
  async cancelTask(taskId: string, body?: { reason?: string }): Promise<{ status: number; data: any }> {
    try {
      if (!taskId) {
        return { status: 400, data: { error: '任务 ID（taskId）不能为空。' } };
      }

      const reason = body?.reason || '用户通过 API 请求手动取消任务';
      const cancelledTask = await this.gateway.cancelTask(taskId, reason);

      return {
        status: 200,
        data: {
          taskId: cancelledTask.id,
          status: cancelledTask.status,
          message: '任务取消操作已处理完成。',
        },
      };
    } catch (err) {
      return {
        status: 500,
        data: { error: `取消任务失败：${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  /**
   * POST /tasks/:id/resume
   */
  async resumeTask(taskId: string, body?: { targetStatus?: TaskStatus; message?: string; data?: Record<string, unknown> }): Promise<{ status: number; data: any }> {
    try {
      if (!taskId) {
        return { status: 400, data: { error: '任务 ID（taskId）不能为空。' } };
      }

      const task = await this.gateway.getTask(taskId);
      if (!task) {
        return { status: 404, data: { error: `未找到 ID 为 '${taskId}' 的任务。` } };
      }

      const nextStatus: TaskStatus = body?.targetStatus || (task.status === 'WAITING_FOR_CONTEXT' ? 'LOADING_CONTEXT' : 'PLANNING');

      const updated = await this.gateway.updateTaskStatus(taskId, nextStatus, {
        message: body?.message || '用户通过 API 请求恢复任务执行',
        payload: body?.data,
      });

      return {
        status: 200,
        data: {
          taskId: updated.id,
          status: updated.status,
          message: `任务已成功恢复流转至 '${nextStatus}' 状态。`,
        },
      };
    } catch (err) {
      return {
        status: 500,
        data: { error: `恢复任务失败：${err instanceof Error ? err.message : String(err)}` },
      };
    }
  }

  /**
   * 获取中文控制台页面 HTML
   */
  getDashboardHtml(): string {
    const htmlPath = path.resolve(process.cwd(), 'src/mastra/public/index.html');
    if (existsSync(htmlPath)) {
      return readFileSync(htmlPath, 'utf-8');
    }
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>AI Engineering Core</title></head><body><h1>AI Engineering Core 控制台</h1><p>页面正在准备中...</p></body></html>`;
  }
}

export const defaultTaskApiController = new TaskApiController();

/**
 * Mastra ApiRoute compliant definitions for task endpoints
 */
export const taskApiRoutes = [
  {
    path: '/',
    method: 'GET' as const,
    handler: async (c: any) => {
      const html = defaultTaskApiController.getDashboardHtml();
      return c.html
        ? c.html(html)
        : new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  },
  {
    path: '/dashboard',
    method: 'GET' as const,
    handler: async (c: any) => {
      const html = defaultTaskApiController.getDashboardHtml();
      return c.html
        ? c.html(html)
        : new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    },
  },
  {
    path: '/tasks',
    method: 'GET' as const,
    handler: async (c: any) => {
      const res = await defaultTaskApiController.listTasks();
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
  {
    path: '/tasks',
    method: 'POST' as const,
    handler: async (c: any) => {
      const body = c.req?.json ? await c.req.json() : c.body;
      const res = await defaultTaskApiController.createTask(body);
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
  {
    path: '/tasks/:id',
    method: 'GET' as const,
    handler: async (c: any) => {
      const id = c.req?.param ? c.req.param('id') : c.params?.id;
      const res = await defaultTaskApiController.getTask(id);
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
  {
    path: '/tasks/:id/timeline',
    method: 'GET' as const,
    handler: async (c: any) => {
      const id = c.req?.param ? c.req.param('id') : c.params?.id;
      const res = await defaultTaskApiController.getTimeline(id);
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
  {
    path: '/tasks/:id/cancel',
    method: 'POST' as const,
    handler: async (c: any) => {
      const id = c.req?.param ? c.req.param('id') : c.params?.id;
      const body = c.req?.json ? await c.req.json() : c.body;
      const res = await defaultTaskApiController.cancelTask(id, body);
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
  {
    path: '/tasks/:id/resume',
    method: 'POST' as const,
    handler: async (c: any) => {
      const id = c.req?.param ? c.req.param('id') : c.params?.id;
      const body = c.req?.json ? await c.req.json() : c.body;
      const res = await defaultTaskApiController.resumeTask(id, body);
      return c.json ? c.json(res.data, res.status) : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    },
  },
];
