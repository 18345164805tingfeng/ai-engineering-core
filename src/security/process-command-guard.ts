export type CommandSafetyLevel = 'SAFE' | 'APPROVAL_REQUIRED' | 'DENIED';

export interface CommandEvaluationResult {
  level: CommandSafetyLevel;
  reason?: string;
}

export interface CommandGuardConfig {
  allow?: string[];
  deny?: string[];
  approvalRequired?: string[];
}

export class ProcessCommandGuardError extends Error {
  public level: CommandSafetyLevel;

  constructor(message: string, level: CommandSafetyLevel = 'DENIED') {
    super(message);
    this.name = 'ProcessCommandGuardError';
    this.level = level;
  }
}

export class ProcessCommandGuard {
  private static readonly DENIED_PATTERNS: RegExp[] = [
    // 磁盘格式化/分区破坏
    /\bformat\s+[a-z]:/i,
    /\bdiskpart\b/i,
    /\bmkfs(\.[a-z0-9]+)?\b/i,
    /\bdd\s+if=/i,
    // 关机 / 重启 / 停机
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\binit\s+[06]\b/i,
    // 根目录与系统级破坏性删除
    /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(\/|~|\.\.|\/etc|\/usr|\/bin|\/var|\/root)($|\s)/i,
    /\brmdir\s+\/s\s+(\/q\s+)?[a-z]:\\?$/i,
    /\bdel\s+\/s\s+(\/q\s+)?[a-z]:\\?$/i,
    // 破坏性 SQL
    /\bDROP\s+(DATABASE|SCHEMA|TABLE)\b/i,
    /\bTRUNCATE\s+(TABLE)?\b/i,
    // Git 危险强推
    /\bgit\s+push\s+.*(--force|-f)\b/i,
  ];

  private static readonly APPROVAL_PATTERNS: RegExp[] = [
    /\brm\s+-[a-z]*r/i,
    /\brmdir\s+\/s/i,
    /\bdel\s+\/s/i,
    /\bgit\s+clean\s+-[a-z]*f/i,
    /\bgit\s+reset\s+--hard/i,
    /\bnpm\s+publish\b/i,
    /\bpnpm\s+publish\b/i,
    /\byarn\s+publish\b/i,
  ];

  private static readonly SAFE_PATTERNS: RegExp[] = [
    /^\s*git\s+(status|diff|log|branch|show|rev-parse|ls-files)\b/i,
    /^\s*npm\s+(test|run\s+test|run\s+build|run\s+lint|run\s+type-check|run\s+check)\b/i,
    /^\s*pnpm\s+(test|run\s+test|run\s+build|run\s+lint|build|lint)\b/i,
    /^\s*yarn\s+(test|build|lint)\b/i,
    /^\s*vitest(\s+run)?\b/i,
    /^\s*pytest\b/i,
    /^\s*mvn\s+test\b/i,
    /^\s*gradle\s+test\b/i,
    /^\s*tsc(\s+--noEmit)?\b/i,
    /^\s*echo\b/i,
    /^\s*node\s+--version\b/i,
    /^\s*npm\s+--version\b/i,
  ];

  /**
   * 评估执行命令的安全级别
   */
  static evaluate(command: string, config?: CommandGuardConfig): CommandEvaluationResult {
    const trimmed = command.trim();
    if (!trimmed) {
      return { level: 'SAFE' };
    }

    // 1. 自定义白名单
    if (config?.allow?.some((pattern) => this.matchRule(trimmed, pattern))) {
      return { level: 'SAFE', reason: '命令已被项目配置白名单显式允许' };
    }

    // 2. 自定义黑名单
    if (config?.deny?.some((pattern) => this.matchRule(trimmed, pattern))) {
      return { level: 'DENIED', reason: `【安全拦截】命令被配置黑名单规则阻止：'${trimmed}'` };
    }

    // 3. 内置高危 DENIED 规则拦截
    for (const pattern of this.DENIED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'DENIED',
          reason: `【安全拦截】高危破坏性系统命令已被禁止执行：'${trimmed}'（匹配规则 ${pattern}）`,
        };
      }
    }

    // 4. 自定义审批列表
    if (config?.approvalRequired?.some((pattern) => this.matchRule(trimmed, pattern))) {
      return { level: 'APPROVAL_REQUIRED', reason: '命令已被配置要求人工审批后方可执行' };
    }

    // 5. 内置审批规则
    for (const pattern of this.APPROVAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'APPROVAL_REQUIRED',
          reason: `【审批要求】该命令存在潜在破坏性，需经确认审批后方可执行：'${trimmed}'`,
        };
      }
    }

    // 6. 安全模式匹配
    for (const pattern of this.SAFE_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { level: 'SAFE' };
      }
    }

    return { level: 'SAFE' };
  }

  /**
   * 断言命令为 SAFE，否则抛出中文错误
   */
  static assertExecutable(command: string, config?: CommandGuardConfig): void {
    const evalResult = this.evaluate(command, config);
    if (evalResult.level === 'DENIED') {
      throw new ProcessCommandGuardError(evalResult.reason || `命令 '${command}' 被安全拦截禁止执行。`, 'DENIED');
    }
    if (evalResult.level === 'APPROVAL_REQUIRED') {
      throw new ProcessCommandGuardError(
        evalResult.reason || `命令 '${command}' 需要人工确认审批后方可执行。`,
        'APPROVAL_REQUIRED'
      );
    }
  }

  private static matchRule(cmd: string, rule: string): boolean {
    if (rule.startsWith('/') && rule.endsWith('/')) {
      const regex = new RegExp(rule.slice(1, -1), 'i');
      return regex.test(cmd);
    }
    return cmd.toLowerCase().includes(rule.toLowerCase());
  }
}
