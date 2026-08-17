import { IExecutor } from '../executor.interface.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  ExecutorCapabilities,
  ExecutorHealth,
  ExecutorType,
} from '../schema/executor.schema.js';

export abstract class ModelExecutor implements IExecutor {
  readonly id: string;
  readonly type: ExecutorType = 'model';

  constructor(id: string) {
    this.id = id;
  }

  getCapabilities(): ExecutorCapabilities {
    return {
      read: true,
      write: false,
      shell: false,
      git: false,
      test: false,
      structuredOutput: true,
    };
  }

  abstract healthCheck(): Promise<ExecutorHealth>;

  protected abstract doExecute(request: ExecutionRequest): Promise<Omit<ExecutionResponse, 'durationMs' | 'executorId' | 'role'>>;

  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    const startTime = Date.now();
    const timeoutMs = request.timeoutMs || 60000;

    try {
      const executePromise = this.doExecute(request);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`ModelExecutor '${this.id}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const res = await Promise.race([executePromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      return {
        ...res,
        durationMs,
        executorId: this.id,
        role: request.role,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
        executorId: this.id,
        role: request.role,
      };
    }
  }

  async cancel(_runId?: string): Promise<boolean> {
    return true;
  }
}
