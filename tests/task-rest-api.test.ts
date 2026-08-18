import { describe, it, expect, beforeEach } from 'vitest';
import { TaskApiController, taskApiRoutes } from '../src/mastra/routes/task-routes.js';
import { TaskGateway } from '../src/gateway/task-gateway.js';
import { InMemoryTaskStore } from '../src/task/store/task-store.js';

describe('Task REST API Controller & Routes', () => {
  let store: InMemoryTaskStore;
  let gateway: TaskGateway;
  let controller: TaskApiController;

  beforeEach(() => {
    store = new InMemoryTaskStore();
    gateway = new TaskGateway(store);
    controller = new TaskApiController(gateway);
  });

  it('POST /tasks should create task and return 201 with taskId', async () => {
    const res = await controller.createTask({
      project: 'demo',
      requirement: 'Add user logout feature',
      triggerWorkflow: false,
    });

    expect(res.status).toBe(201);
    expect(res.data.taskId).toBeDefined();
    expect(res.data.status).toBe('CREATED');
  });

  it('POST /tasks should return 400 when body or requirement is missing', async () => {
    const res = await controller.createTask({});
    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
  });

  it('GET /tasks/:id should return redacted task details and 404 if not found', async () => {
    const createRes = await controller.createTask({
      project: 'demo',
      requirement: 'Test task with apiKey sk-proj-12345678901234567890',
      triggerWorkflow: false,
    });
    const taskId = createRes.data.taskId;

    const getRes = await controller.getTask(taskId);
    expect(getRes.status).toBe(200);
    expect(getRes.data.id).toBe(taskId);
    expect(getRes.data.requirement.title).toContain('[REDACTED]');

    const notFoundRes = await controller.getTask('NON-EXISTENT');
    expect(notFoundRes.status).toBe(404);
  });

  it('GET /tasks/:id/timeline should return timeline events array', async () => {
    const createRes = await controller.createTask({
      project: 'demo',
      requirement: 'Timeline test task',
      triggerWorkflow: false,
    });
    const taskId = createRes.data.taskId;

    const timelineRes = await controller.getTimeline(taskId);
    expect(timelineRes.status).toBe(200);
    expect(Array.isArray(timelineRes.data)).toBe(true);
    expect(timelineRes.data.length).toBeGreaterThanOrEqual(1);
  });

  it('POST /tasks/:id/cancel should cancel task', async () => {
    const createRes = await controller.createTask({
      project: 'demo',
      requirement: 'Cancel test task',
      triggerWorkflow: false,
    });
    const taskId = createRes.data.taskId;

    const cancelRes = await controller.cancelTask(taskId, { reason: 'User requested abort' });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.data.status).toBe('CANCELLED');

    const getRes = await controller.getTask(taskId);
    expect(getRes.data.status).toBe('CANCELLED');
  });

  it('POST /tasks/:id/resume should resume task to valid state', async () => {
    const createRes = await controller.createTask({
      project: 'demo',
      requirement: 'Resume test task',
      triggerWorkflow: false,
    });
    const taskId = createRes.data.taskId;

    // Move to WAITING_FOR_CONTEXT first
    await gateway.updateTaskStatus(taskId, 'LOADING_CONTEXT');
    await gateway.updateTaskStatus(taskId, 'WAITING_FOR_CONTEXT');

    const resumeRes = await controller.resumeTask(taskId, { data: { config: 'resolved' } });
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.data.status).toBe('LOADING_CONTEXT');
  });

  it('taskApiRoutes list should contain all 5 endpoint definitions', () => {
    expect(taskApiRoutes.length).toBeGreaterThanOrEqual(5);
    const paths = taskApiRoutes.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('POST /tasks');
    expect(paths).toContain('GET /tasks/:id');
    expect(paths).toContain('GET /tasks/:id/timeline');
    expect(paths).toContain('POST /tasks/:id/cancel');
    expect(paths).toContain('POST /tasks/:id/resume');
  });
});
