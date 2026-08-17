import { spawn } from 'child_process';

export interface ProcessResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  timedOut?: boolean;
}

export interface ProcessOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Optional custom runner for unit testing */
  customRunner?: (
    command: string,
    options: ProcessOptions
  ) => Promise<ProcessResult>;
}

export async function runProcess(
  command: string,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const startTime = Date.now();

  if (options.customRunner) {
    return options.customRunner(command, options);
  }

  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs || 120000;

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;

    const child = spawn(command, {
      cwd,
      shell: process.platform === 'win32',
      env: { ...process.env, ...options.env },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 3000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        command,
        exitCode: -1,
        stdout: stdoutData,
        stderr: err.message,
        durationMs,
        success: false,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? -1;

      resolve({
        command,
        exitCode,
        stdout: stdoutData,
        stderr: stderrData,
        durationMs,
        success: exitCode === 0 && !timedOut,
        timedOut,
      });
    });
  });
}
