import { IExecutor } from './executor.interface.js';

export class ExecutorRegistry {
  private executors: Map<string, IExecutor> = new Map();

  registerExecutor(executor: IExecutor): void {
    if (this.executors.has(executor.id)) {
      console.warn(`Executor '${executor.id}' is already registered. Overwriting registration.`);
    }
    this.executors.set(executor.id, executor);
  }

  getExecutor(id: string): IExecutor | undefined {
    return this.executors.get(id);
  }

  hasExecutor(id: string): boolean {
    return this.executors.has(id);
  }

  unregisterExecutor(id: string): boolean {
    return this.executors.delete(id);
  }

  listExecutors(): IExecutor[] {
    return Array.from(this.executors.values());
  }

  clear(): void {
    this.executors.clear();
  }
}

export const defaultExecutorRegistry = new ExecutorRegistry();
