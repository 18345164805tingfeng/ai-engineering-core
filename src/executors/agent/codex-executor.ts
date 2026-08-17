import { spawn, ChildProcess } from 'child_process';
import { AgentExecutor } from '../base/agent-executor.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  ExecutorCapabilities,
  ExecutorHealth,
} from '../schema/executor.schema.js';
import { decodeOutputBuffer } from '../../tools/process-tool.js';

export interface CodexExecutorOptions {
  id?: string;
  cliPath?: string;
  extraArgs?: string[];
  /** Custom runner for mock/testing environments */
  customRunner?: (
    command: string,
    args: string[],
    options: { cwd: string; timeout: number; env?: Record<string, string> }
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export class CodexAgentExecutor extends AgentExecutor {
  private readonly cliPath: string;
  private readonly extraArgs: string[];
  private readonly customRunner?: CodexExecutorOptions['customRunner'];
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private consecutiveFailures = 0;
  private lastSuccessAt?: string;
  private lastFailureAt?: string;
  private lastError?: string;

  constructor(options: CodexExecutorOptions = {}) {
    super(options.id || 'codex');
    this.cliPath = options.cliPath || 'codex';
    this.extraArgs = options.extraArgs || [];
    this.customRunner = options.customRunner;
  }

  override getCapabilities(): ExecutorCapabilities {
    return {
      read: true,
      write: true,
      shell: true,
      git: true,
      test: true,
      structuredOutput: true,
    };
  }

  async healthCheck(): Promise<ExecutorHealth> {
    const startTime = Date.now();
    try {
      if (this.customRunner) {
        const res = await this.customRunner(this.cliPath, ['--version'], {
          cwd: process.cwd(),
          timeout: 5000,
        });
        const latencyMs = Date.now() - startTime;
        if (res.exitCode === 0) {
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
      } else {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(this.cliPath, ['--version'], {
            shell: process.platform === 'win32',
            timeout: 5000,
          });

          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`CLI health check failed with exit code ${code}`));
          });
        });

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
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        executorId: this.id,
        status: 'UNAVAILABLE',
        consecutiveFailures: this.consecutiveFailures + 1,
        latencyMs,
        lastSuccessAt: this.lastSuccessAt,
        lastFailureAt: this.lastFailureAt || new Date().toISOString(),
        lastError: errorMsg,
        circuit: 'closed',
      };
    }

    return {
      executorId: this.id,
      status: 'UNAVAILABLE',
      consecutiveFailures: this.consecutiveFailures,
      lastError: 'Unknown health check status',
      circuit: 'closed',
    };
  }

  protected async doExecute(
    request: ExecutionRequest
  ): Promise<Omit<ExecutionResponse, 'durationMs' | 'executorId' | 'role'>> {
    const cwd = request.projectContext?.projectRoot || process.cwd();
    const timeout = request.timeoutMs || 600000;
    const runId = request.task?.id || `run-${Date.now()}`;

    const promptText =
      request.prompt ||
      request.instruction ||
      `Task Requirement: ${request.task?.requirement?.title || ''}\n${
        request.task?.requirement?.description || ''
      }`;

    const args = [...this.extraArgs];
    if (promptText) {
      args.push(promptText);
    }

    if (this.customRunner) {
      try {
        const res = await this.customRunner(this.cliPath, args, {
          cwd,
          timeout,
          env: process.env as Record<string, string>,
        });

        if (res.exitCode === 0) {
          this.consecutiveFailures = 0;
          this.lastSuccessAt = new Date().toISOString();
          return {
            success: true,
            output: res.stdout,
            structuredResult: { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode },
          };
        } else {
          this.consecutiveFailures++;
          this.lastFailureAt = new Date().toISOString();
          this.lastError = res.stderr || `Codex CLI exit with code ${res.exitCode}`;
          return {
            success: false,
            output: res.stdout,
            error: res.stderr || `Codex CLI failed with exit code ${res.exitCode}`,
            structuredResult: { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode },
          };
        }
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

    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let killedByTimeout = false;

      const child = spawn(this.cliPath, args, {
        cwd,
        env: process.env,
        shell: process.platform === 'win32',
      });

      this.activeProcesses.set(runId, child);

      const timer = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
      }, timeout);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);
        const stdout = decodeOutputBuffer(stdoutChunks);
        const errorMsg = `Failed to spawn Codex CLI process: ${err.message}`;
        this.consecutiveFailures++;
        this.lastFailureAt = new Date().toISOString();
        this.lastError = errorMsg;
        resolve({
          success: false,
          output: stdout || null,
          error: errorMsg,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);

        const stdout = decodeOutputBuffer(stdoutChunks);
        const stderr = decodeOutputBuffer(stderrChunks);

        if (killedByTimeout) {
          const errorMsg = `Codex CLI process timed out after ${timeout}ms`;
          this.consecutiveFailures++;
          this.lastFailureAt = new Date().toISOString();
          this.lastError = errorMsg;
          resolve({
            success: false,
            output: stdout,
            error: errorMsg,
          });
          return;
        }

        if (code === 0) {
          this.consecutiveFailures = 0;
          this.lastSuccessAt = new Date().toISOString();
          resolve({
            success: true,
            output: stdout,
            structuredResult: { stdout, stderr, exitCode: code },
          });
        } else {
          const errorMsg = stderr.trim() || `Codex CLI exited with code ${code}`;
          this.consecutiveFailures++;
          this.lastFailureAt = new Date().toISOString();
          this.lastError = errorMsg;
          resolve({
            success: false,
            output: stdout,
            error: errorMsg,
            structuredResult: { stdout, stderr, exitCode: code },
          });
        }
      });
    });
  }

  override async cancel(runId?: string): Promise<boolean> {
    if (runId && this.activeProcesses.has(runId)) {
      const child = this.activeProcesses.get(runId);
      if (child && !child.killed) {
        child.kill('SIGTERM');
        this.activeProcesses.delete(runId);
        return true;
      }
    } else {
      // Cancel all active child processes
      let canceled = false;
      for (const [id, child] of this.activeProcesses.entries()) {
        if (child && !child.killed) {
          child.kill('SIGTERM');
          canceled = true;
        }
        this.activeProcesses.delete(id);
      }
      return canceled;
    }
    return false;
  }
}
