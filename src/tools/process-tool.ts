import { spawn } from 'child_process';
import path from 'node:path';
import { ProcessCommandGuard, CommandGuardConfig } from '../security/process-command-guard.js';
import { ProjectPathGuard } from '../security/project-path-guard.js';
import { SecretRedactor } from '../security/secret-redactor.js';

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
  projectRoot?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  commandConfig?: CommandGuardConfig;
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

  // 1. ProcessCommandGuard security check
  const evalResult = ProcessCommandGuard.evaluate(command, options.commandConfig);
  if (evalResult.level !== 'SAFE') {
    return {
      command,
      exitCode: 126,
      stdout: '',
      stderr: `[Security Error] Command blocked (${evalResult.level}): ${evalResult.reason || 'Not permitted'}`,
      durationMs: 0,
      success: false,
      timedOut: false,
    };
  }

  // 2. ProjectPathGuard cwd check if projectRoot is supplied
  let cwd = options.cwd || process.cwd();
  if (options.projectRoot) {
    try {
      cwd = ProjectPathGuard.validatePath(options.projectRoot, cwd);
    } catch (err) {
      return {
        command,
        exitCode: 126,
        stdout: '',
        stderr: `[Security Error] Working directory outside projectRoot: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: 0,
        success: false,
        timedOut: false,
      };
    }
  }

  if (options.customRunner) {
    const customRes = await options.customRunner(command, options);
    return {
      ...customRes,
      stdout: SecretRedactor.redactText(customRes.stdout),
      stderr: SecretRedactor.redactText(customRes.stderr),
    };
  }

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
      const stdout = SecretRedactor.redactText(decodeOutputBuffer(stdoutChunks));
      const stderr = SecretRedactor.redactText(decodeOutputBuffer(stderrChunks) || err.message);

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
      const stdout = SecretRedactor.redactText(decodeOutputBuffer(stdoutChunks));
      const stderr = SecretRedactor.redactText(decodeOutputBuffer(stderrChunks));

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
