import { ModelExecutor } from '../base/model-executor.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  ExecutorCapabilities,
  ExecutorHealth,
} from '../schema/executor.schema.js';

export interface OllamaExecutorOptions {
  id?: string;
  host?: string;
  model?: string;
  customRunner?: (
    request: ExecutionRequest
  ) => Promise<{ output: string; structuredResult?: unknown; error?: string }>;
}

export class OllamaModelExecutor extends ModelExecutor {
  private readonly host: string;
  private readonly modelName: string;
  private readonly customRunner?: OllamaExecutorOptions['customRunner'];
  private consecutiveFailures = 0;
  private lastSuccessAt?: string;
  private lastFailureAt?: string;
  private lastError?: string;

  constructor(options: OllamaExecutorOptions = {}) {
    super(options.id || 'qwen-local');
    this.host = (options.host || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
    this.modelName = options.model || process.env.OLLAMA_MODEL || 'qwen2.5-coder';
    this.customRunner = options.customRunner;
  }

  override getCapabilities(): ExecutorCapabilities {
    return {
      read: true,
      write: false,
      shell: false,
      git: false,
      test: false,
      structuredOutput: true,
    };
  }

  async healthCheck(): Promise<ExecutorHealth> {
    const startTime = Date.now();

    if (this.customRunner) {
      const latencyMs = Date.now() - startTime;
      return {
        executorId: this.id,
        status: 'HEALTHY',
        consecutiveFailures: this.consecutiveFailures,
        latencyMs,
        lastSuccessAt: this.lastSuccessAt,
        lastFailureAt: this.lastFailureAt,
        lastError: this.lastError,
        circuit: 'closed',
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const resp = await fetch(`${this.host}/api/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      if (resp.ok) {
        return {
          executorId: this.id,
          status: 'HEALTHY',
          consecutiveFailures: this.consecutiveFailures,
          latencyMs,
          lastSuccessAt: this.lastSuccessAt,
          lastFailureAt: this.lastFailureAt,
          lastError: this.lastError,
          circuit: 'closed',
        };
      } else {
        const errorMsg = `Ollama health check returned HTTP ${resp.status}`;
        return {
          executorId: this.id,
          status: 'UNAVAILABLE',
          consecutiveFailures: this.consecutiveFailures + 1,
          latencyMs,
          lastFailureAt: new Date().toISOString(),
          lastError: errorMsg,
          circuit: 'closed',
        };
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        executorId: this.id,
        status: 'UNAVAILABLE',
        consecutiveFailures: this.consecutiveFailures + 1,
        latencyMs,
        lastFailureAt: new Date().toISOString(),
        lastError: errorMsg,
        circuit: 'closed',
      };
    }
  }

  protected async doExecute(
    request: ExecutionRequest
  ): Promise<Omit<ExecutionResponse, 'durationMs' | 'executorId' | 'role'>> {
    if (this.customRunner) {
      try {
        const res = await this.customRunner(request);
        if (res.error) {
          this.consecutiveFailures++;
          this.lastFailureAt = new Date().toISOString();
          this.lastError = res.error;
          return {
            success: false,
            output: res.output,
            error: res.error,
          };
        }

        this.consecutiveFailures = 0;
        this.lastSuccessAt = new Date().toISOString();
        return {
          success: true,
          output: res.output,
          structuredResult: res.structuredResult || res.output,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.consecutiveFailures++;
        this.lastFailureAt = new Date().toISOString();
        this.lastError = errorMsg;
        return {
          success: false,
          output: null,
          error: errorMsg,
        };
      }
    }

    const promptText =
      request.prompt ||
      request.instruction ||
      `Task Requirement: ${request.task?.requirement?.title || ''}\n${
        request.task?.requirement?.description || ''
      }`;

    try {
      const controller = new AbortController();
      const timeoutMs = request.timeoutMs || 60000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          prompt: promptText,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errorMsg = `Ollama API returned HTTP status ${resp.status}`;
        this.consecutiveFailures++;
        this.lastFailureAt = new Date().toISOString();
        this.lastError = errorMsg;
        return {
          success: false,
          output: null,
          error: errorMsg,
        };
      }

      const data = (await resp.json()) as { response?: string };
      const outputText = data.response || '';

      this.consecutiveFailures = 0;
      this.lastSuccessAt = new Date().toISOString();
      return {
        success: true,
        output: outputText,
        structuredResult: { text: outputText, model: this.modelName },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.consecutiveFailures++;
      this.lastFailureAt = new Date().toISOString();
      this.lastError = errorMsg;
      return {
        success: false,
        output: null,
        error: errorMsg,
      };
    }
  }
}
