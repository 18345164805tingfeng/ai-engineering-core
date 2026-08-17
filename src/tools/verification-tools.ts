import { existsSync } from 'node:fs';
import path from 'node:path';
import { Role } from '../executors/schema/executor.schema.js';
import { ProjectContext } from '../project/schema/project.schema.js';
import { ProcessOptions, ProcessResult, runProcess } from './process-tool.js';

export type ToolAction = 'read' | 'write' | 'shell' | 'git' | 'test' | 'lint' | 'build';

const ROLE_PERMISSIONS: Record<Role, Record<ToolAction, boolean>> = {
  planner: {
    read: true,
    write: false,
    shell: false,
    git: true,
    test: false,
    lint: false,
    build: false,
  },
  developer: {
    read: true,
    write: true,
    shell: true,
    git: true,
    test: true,
    lint: true,
    build: true,
  },
  reviewer: {
    read: true,
    write: false,
    shell: false,
    git: true,
    test: true,
    lint: true,
    build: true,
  },
  tester: {
    read: true,
    write: false,
    shell: true,
    git: true,
    test: true,
    lint: true,
    build: true,
  },
  architect: {
    read: true,
    write: false,
    shell: false,
    git: true,
    test: false,
    lint: false,
    build: false,
  },
  router: {
    read: true,
    write: false,
    shell: false,
    git: false,
    test: false,
    lint: false,
    build: false,
  },
};

export function checkToolPermission(role: Role, action: ToolAction): boolean {
  const roleRules = ROLE_PERMISSIONS[role];
  if (!roleRules) return false;
  return roleRules[action] ?? false;
}

export class VerificationToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationToolError';
  }
}

export async function runTestTool(
  role: Role,
  projectContext: ProjectContext,
  customCommand?: string,
  options?: ProcessOptions
): Promise<ProcessResult> {
  if (!checkToolPermission(role, 'test')) {
    throw new VerificationToolError(`Role '${role}' is not allowed to run test tools.`);
  }

  const cwd = projectContext.projectRoot;
  let cmd = customCommand || projectContext.commands?.test;

  // Auto-detect project venv test command if generic pytest is specified
  const venvPythonWin = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  if (!cmd || cmd === 'pytest') {
    if (existsSync(venvPythonWin)) {
      cmd = '.venv/Scripts/python.exe main.py --quick-test-for-ci --disable-manager';
    } else {
      cmd = 'npm test';
    }
  }

  let result = await runProcess(cmd, {
    cwd,
    ...options,
  });

  // Fallback to project venv python if global command (like bare 'pytest') failed due to missing PATH binary
  if (!result.success && result.stderr.includes('不是内部或外部命令')) {
    if (existsSync(venvPythonWin) && !cmd.includes('.venv')) {
      const fallbackCmd = '.venv/Scripts/python.exe main.py --quick-test-for-ci --disable-manager';
      const fallbackResult = await runProcess(fallbackCmd, { cwd, ...options });
      if (fallbackResult.success || fallbackResult.exitCode === 0) {
        return fallbackResult;
      }
    }
  }

  // Handle WinError 32 file lock: kill orphan python processes and retry task execution
  const hasFileLockError =
    (result.stderr && (result.stderr.includes('另一个程序正在使用此文件') || result.stderr.includes('WinError 32'))) ||
    (result.stdout && (result.stdout.includes('另一个程序正在使用此文件') || result.stdout.includes('WinError 32')));

  if (hasFileLockError && process.platform === 'win32') {
    try {
      console.log('[VerificationTool] File lock detected (WinError 32). Terminating orphan python processes...');
      await runProcess('taskkill /f /im python.exe', { cwd });
    } catch {
      // ignore taskkill errors if no process was running
    }
    // Retry command after killing orphan processes
    result = await runProcess(cmd, {
      cwd,
      ...options,
    });
  }

  return result;
}

export async function runLintTool(
  role: Role,
  projectContext: ProjectContext,
  customCommand?: string,
  options?: ProcessOptions
): Promise<ProcessResult> {
  if (!checkToolPermission(role, 'lint')) {
    throw new VerificationToolError(`Role '${role}' is not allowed to run lint tools.`);
  }

  const cmd = customCommand || projectContext.commands?.lint || 'npm run lint';
  const cwd = projectContext.projectRoot;

  return runProcess(cmd, {
    cwd,
    ...options,
  });
}

export async function runBuildTool(
  role: Role,
  projectContext: ProjectContext,
  customCommand?: string,
  options?: ProcessOptions
): Promise<ProcessResult> {
  if (!checkToolPermission(role, 'build')) {
    throw new VerificationToolError(`Role '${role}' is not allowed to run build tools.`);
  }

  const cmd = customCommand || projectContext.commands?.build || 'npm run build';
  const cwd = projectContext.projectRoot;

  return runProcess(cmd, {
    cwd,
    ...options,
  });
}
