import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Task } from '../task/schema/task.schema.js';
import { ProjectContext } from '../project/schema/project.schema.js';
import { defaultExecutorRegistry, ExecutorRegistry } from '../executors/executor-registry.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  Role,
  RoleMapping,
  RolesConfig,
  RolesConfigSchema,
} from '../executors/schema/executor.schema.js';
import { defaultHealthManager, HealthManager } from './health-manager.js';

export interface ExecuteRoleOptions {
  role: Role;
  task: Task;
  projectContext: ProjectContext;
  prompt?: string;
  instruction?: string;
  contextData?: Record<string, unknown>;
  timeoutMs?: number;
}

const DEFAULT_ROLES_CONFIG: RolesConfig = {
  roles: {
    router: { primary: 'qwen-local', fallback: [] },
    planner: { primary: 'antigravity-planner', fallback: ['qwen-local'] },
    developer: { primary: 'codex', fallback: ['qwen-local'] },
    reviewer: { primary: 'antigravity-reviewer', fallback: ['qwen-local'] },
    tester: { primary: 'codex', fallback: ['qwen-local'] },
    architect: { primary: 'antigravity-architect', fallback: ['qwen-local'] },
  },
};

export class ExecutorRouter {
  private configPath: string;
  private rolesConfig: RolesConfig = JSON.parse(JSON.stringify(DEFAULT_ROLES_CONFIG));
  private registry: ExecutorRegistry;
  private healthManager: HealthManager;

  constructor(options?: {
    configPath?: string;
    registry?: ExecutorRegistry;
    healthManager?: HealthManager;
  }) {
    this.configPath = options?.configPath || path.resolve(process.cwd(), 'config', 'roles.yaml');
    this.registry = options?.registry || defaultExecutorRegistry;
    this.healthManager = options?.healthManager || defaultHealthManager;
    this.loadConfig();
  }

  loadConfig(): void {
    const candidatePaths = [
      this.configPath,
      path.resolve(process.cwd(), 'config', 'roles.yaml'),
      path.resolve(process.cwd(), '..', 'config', 'roles.yaml'),
    ];

    let foundPath: string | null = null;
    for (const p of candidatePaths) {
      if (p && existsSync(p)) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      this.rolesConfig = JSON.parse(JSON.stringify(DEFAULT_ROLES_CONFIG));
      return;
    }

    try {
      const content = readFileSync(foundPath, 'utf-8');
      const raw = parseYaml(content) || {};
      const parsed = RolesConfigSchema.parse(raw);
      this.rolesConfig = {
        roles: {
          ...DEFAULT_ROLES_CONFIG.roles,
          ...parsed.roles,
        },
      };
    } catch {
      this.rolesConfig = JSON.parse(JSON.stringify(DEFAULT_ROLES_CONFIG));
    }
  }

  setRolesConfig(config: RolesConfig): void {
    this.rolesConfig = {
      roles: {
        ...DEFAULT_ROLES_CONFIG.roles,
        ...RolesConfigSchema.parse(config).roles,
      },
    };
  }

  getRoleMapping(role: Role): RoleMapping {
    const mapping = this.rolesConfig.roles[role] || DEFAULT_ROLES_CONFIG.roles[role];
    if (!mapping) {
      return { primary: 'qwen-local', fallback: [] };
    }
    return mapping;
  }

  async executeRole(options: ExecuteRoleOptions): Promise<ExecutionResponse> {
    const { role, task, projectContext, prompt, instruction, contextData, timeoutMs } = options;
    const mapping = this.getRoleMapping(role);
    const candidateExecutorIds = [mapping.primary, ...(mapping.fallback || [])];

    const attemptsErrors: string[] = [];
    const startTime = Date.now();

    for (let i = 0; i < candidateExecutorIds.length; i++) {
      const executorId = candidateExecutorIds[i];
      if (!executorId) continue;

      const executor = this.registry.getExecutor(executorId);
      if (!executor) {
        const errorMsg = `Executor '${executorId}' is mapped to role '${role}' but not registered in ExecutorRegistry.`;
        attemptsErrors.push(errorMsg);
        this.healthManager.recordFailure(executorId, errorMsg);
        continue;
      }

      // Check health before execution
      const isAvailable = this.healthManager.isAvailable(executorId);
      if (!isAvailable) {
        const errorMsg = `Executor '${executorId}' is marked UNAVAILABLE / CIRCUIT_OPEN, skipping to fallback.`;
        attemptsErrors.push(errorMsg);
        continue;
      }

      const request: ExecutionRequest = {
        role,
        task,
        projectContext,
        prompt,
        instruction,
        contextData,
        timeoutMs: timeoutMs || 60000,
      };

      try {
        const response = await executor.execute(request);
        if (response.success) {
          this.healthManager.recordSuccess(executorId, response.durationMs);
          return response;
        } else {
          const failMsg = response.error || 'Execution returned unsuccessful response';
          attemptsErrors.push(`[${executorId}] ${failMsg}`);
          this.healthManager.recordFailure(executorId, failMsg);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        attemptsErrors.push(`[${executorId}] ${errorMsg}`);
        this.healthManager.recordFailure(executorId, errorMsg);
      }
    }

    const totalDuration = Date.now() - startTime;
    return {
      success: false,
      output: null,
      error: `All candidate executors failed for role '${role}' (Candidates: [${candidateExecutorIds.join(', ')}]). Details:\n${attemptsErrors.join('\n')}`,
      durationMs: totalDuration,
      executorId: mapping.primary,
      role,
    };
  }
}

export const defaultExecutorRouter = new ExecutorRouter();
