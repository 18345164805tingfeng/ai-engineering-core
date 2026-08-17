import {
  ExecutionRequest,
  ExecutionResponse,
  ExecutorCapabilities,
  ExecutorHealth,
  ExecutorType,
} from './schema/executor.schema.js';

export interface IExecutor {
  readonly id: string;
  readonly type: ExecutorType;

  getCapabilities(): ExecutorCapabilities;
  healthCheck(): Promise<ExecutorHealth>;
  execute(request: ExecutionRequest): Promise<ExecutionResponse>;
  cancel(runId?: string): Promise<boolean>;
}
