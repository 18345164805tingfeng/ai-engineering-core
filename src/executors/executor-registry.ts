import { IExecutor } from './executor.interface.js';
import { CodexAgentExecutor } from './agent/codex-executor.js';
import { AntigravityAgentExecutor } from './agent/antigravity-executor.js';
import { OllamaModelExecutor } from './model/ollama-executor.js';

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

// Auto-register standard V1 executors
defaultExecutorRegistry.registerExecutor(new CodexAgentExecutor({ id: 'codex' }));
defaultExecutorRegistry.registerExecutor(new AntigravityAgentExecutor({ id: 'antigravity-reviewer', agentRole: 'reviewer' }));
defaultExecutorRegistry.registerExecutor(new AntigravityAgentExecutor({ id: 'antigravity-planner', agentRole: 'planner' }));
defaultExecutorRegistry.registerExecutor(new AntigravityAgentExecutor({ id: 'antigravity-architect', agentRole: 'architect' }));
defaultExecutorRegistry.registerExecutor(new OllamaModelExecutor({ id: 'qwen-local', model: 'qwen3.6:latest' }));
