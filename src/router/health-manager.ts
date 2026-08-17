import { IExecutor } from '../executors/executor.interface.js';
import { ExecutorHealth, ExecutorHealthSchema } from '../executors/schema/executor.schema.js';

export class HealthManager {
  private healthMap: Map<string, ExecutorHealth> = new Map();
  private failureThreshold = 3;

  constructor(options?: { failureThreshold?: number }) {
    if (options?.failureThreshold) {
      this.failureThreshold = options.failureThreshold;
    }
  }

  getHealth(executorId: string): ExecutorHealth {
    const existing = this.healthMap.get(executorId);
    if (existing) {
      return structuredClone(existing);
    }

    const initial: ExecutorHealth = {
      executorId,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      circuit: 'closed',
    };
    this.healthMap.set(executorId, initial);
    return structuredClone(initial);
  }

  recordSuccess(executorId: string, latencyMs?: number): void {
    const current = this.getHealth(executorId);
    const now = new Date().toISOString();

    const updated: ExecutorHealth = {
      ...current,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      latencyMs: latencyMs ?? current.latencyMs,
      lastSuccessAt: now,
      circuit: 'closed',
      lastError: undefined,
    };

    this.healthMap.set(executorId, ExecutorHealthSchema.parse(updated));
  }

  recordFailure(executorId: string, error: string): void {
    const current = this.getHealth(executorId);
    const now = new Date().toISOString();
    const failures = current.consecutiveFailures + 1;

    let status = current.status;
    let circuit = current.circuit;

    if (failures >= this.failureThreshold) {
      status = 'UNAVAILABLE';
      circuit = 'open';
    } else {
      status = 'DEGRADED';
    }

    const updated: ExecutorHealth = {
      ...current,
      status,
      consecutiveFailures: failures,
      lastFailureAt: now,
      lastError: error,
      circuit,
    };

    this.healthMap.set(executorId, ExecutorHealthSchema.parse(updated));
  }

  isAvailable(executorId: string): boolean {
    const health = this.healthMap.get(executorId);
    if (!health) return true;
    return health.status !== 'UNAVAILABLE' && health.circuit !== 'open';
  }

  async checkHealth(executor: IExecutor): Promise<ExecutorHealth> {
    try {
      const health = await executor.healthCheck();
      this.healthMap.set(executor.id, health);
      return health;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordFailure(executor.id, errorMsg);
      return this.getHealth(executor.id);
    }
  }

  getAllHealth(): ExecutorHealth[] {
    return Array.from(this.healthMap.values()).map(h => structuredClone(h));
  }

  reset(executorId?: string): void {
    if (executorId) {
      this.healthMap.delete(executorId);
    } else {
      this.healthMap.clear();
    }
  }
}

export const defaultHealthManager = new HealthManager();
