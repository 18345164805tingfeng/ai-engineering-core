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

  const cmd = customCommand || projectContext.commands?.test || 'npm test';
  const cwd = projectContext.projectRoot;

  return runProcess(cmd, {
    cwd,
    ...options,
  });
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
