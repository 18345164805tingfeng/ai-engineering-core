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

export function decodeOutputBuffer(buffers: Buffer[]): string {
  if (!buffers || buffers.length === 0) return '';
  const concatenated = Buffer.concat(buffers);
  const utf8Text = concatenated.toString('utf-8');

  // If running on Windows and UTF-8 replacement character \uFFFD is detected, decode using GBK/CP936
  if (process.platform === 'win32' && utf8Text.includes('\uFFFD')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(concatenated);
    } catch {
      return utf8Text;
    }
  }

  return utf8Text;
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

  let finalCommand = command;
  if (process.platform === 'win32') {
    const parts = command.split(' ');
    if (parts[0].includes('/')) {
      parts[0] = path.normalize(parts[0]);
      finalCommand = parts.join(' ');
    }
  }

  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const child = spawn(finalCommand, {
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

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const stdout = decodeOutputBuffer(stdoutChunks);
      const stderr = decodeOutputBuffer(stderrChunks) || err.message;

      resolve({
        command,
        exitCode: -1,
        stdout,
        stderr,
        durationMs,
        success: false,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const exitCode = code ?? -1;
      const stdout = decodeOutputBuffer(stdoutChunks);
      const stderr = decodeOutputBuffer(stderrChunks);

      resolve({
        command,
        exitCode,
        stdout,
        stderr,
        durationMs,
        success: exitCode === 0 && !timedOut,
        timedOut,
      });
    });
  });
}
