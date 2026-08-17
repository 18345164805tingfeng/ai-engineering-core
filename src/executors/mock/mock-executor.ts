import { AgentExecutor } from '../base/agent-executor.js';
import { ModelExecutor } from '../base/model-executor.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  ExecutorHealth,
  ExecutorHealthStatus,
} from '../schema/executor.schema.js';

export interface MockExecutorOptions {
  healthStatus?: ExecutorHealthStatus;
  simulateFailure?: boolean;
  failureError?: string;
  delayMs?: number;
  responseHandler?: (request: ExecutionRequest) => Promise<{ output: unknown; structuredResult?: unknown }>;
}

export class MockAgentExecutor extends AgentExecutor {
  private options: MockExecutorOptions;

  constructor(id: string, options: MockExecutorOptions = {}) {
    super(id);
    this.options = options;
  }

  setOptions(options: Partial<MockExecutorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async healthCheck(): Promise<ExecutorHealth> {
    const status = this.options.healthStatus || 'HEALTHY';
    return {
      executorId: this.id,
      status,
      consecutiveFailures: status === 'HEALTHY' ? 0 : 1,
      latencyMs: 10,
      circuit: status === 'UNAVAILABLE' ? 'open' : 'closed',
      lastSuccessAt: status === 'HEALTHY' ? new Date().toISOString() : undefined,
      lastFailureAt: status !== 'HEALTHY' ? new Date().toISOString() : undefined,
      lastError: status !== 'HEALTHY' ? this.options.failureError || 'Mock health check failure' : undefined,
    };
  }

  protected async doExecute(request: ExecutionRequest): Promise<Omit<ExecutionResponse, 'durationMs' | 'executorId' | 'role'>> {
    if (this.options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }

    if (this.options.simulateFailure) {
      throw new Error(this.options.failureError || `MockAgentExecutor '${this.id}' simulated execution failure`);
    }

    if (this.options.responseHandler) {
      const handled = await this.options.responseHandler(request);
      return {
        success: true,
        output: handled.output,
        structuredResult: handled.structuredResult,
      };
    }

    return {
      success: true,
      output: `MockAgentExecutor [${this.id}] executed role [${request.role}] for task [${request.task.id}]`,
      structuredResult: {
        role: request.role,
        taskId: request.task.id,
        projectId: request.projectContext.projectId,
      },
    };
  }
}

export class MockModelExecutor extends ModelExecutor {
  private options: MockExecutorOptions;

  constructor(id: string, options: MockExecutorOptions = {}) {
    super(id);
    this.options = options;
  }

  setOptions(options: Partial<MockExecutorOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async healthCheck(): Promise<ExecutorHealth> {
    const status = this.options.healthStatus || 'HEALTHY';
    return {
      executorId: this.id,
      status,
      consecutiveFailures: status === 'HEALTHY' ? 0 : 1,
      latencyMs: 5,
      circuit: status === 'UNAVAILABLE' ? 'open' : 'closed',
      lastSuccessAt: status === 'HEALTHY' ? new Date().toISOString() : undefined,
      lastFailureAt: status !== 'HEALTHY' ? new Date().toISOString() : undefined,
      lastError: status !== 'HEALTHY' ? this.options.failureError || 'Mock health check failure' : undefined,
    };
  }

  protected async doExecute(request: ExecutionRequest): Promise<Omit<ExecutionResponse, 'durationMs' | 'executorId' | 'role'>> {
    if (this.options.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.options.delayMs));
    }

    if (this.options.simulateFailure) {
      throw new Error(this.options.failureError || `MockModelExecutor '${this.id}' simulated execution failure`);
    }

    if (this.options.responseHandler) {
      const handled = await this.options.responseHandler(request);
      return {
        success: true,
        output: handled.output,
        structuredResult: handled.structuredResult,
      };
    }

    return {
      success: true,
      output: `MockModelExecutor [${this.id}] executed role [${request.role}] for task [${request.task.id}]`,
      structuredResult: {
        role: request.role,
        taskId: request.task.id,
      },
    };
  }
}
