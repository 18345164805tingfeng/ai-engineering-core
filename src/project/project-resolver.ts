import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  ProjectConfig,
  ProjectsConfig,
  ProjectsConfigSchema,
} from './schema/project.schema.js';

export interface ResolvedProject {
  projectId: string;
  name: string;
  root: string;
  config: ProjectConfig;
}

export class ProjectResolver {
  private configPath: string;
  private basePath: string;
  private config: ProjectsConfig = { projects: {} };

  constructor(options?: { configPath?: string; basePath?: string }) {
    this.configPath = options?.configPath || path.resolve(process.cwd(), 'config', 'projects.yaml');
    this.basePath = options?.basePath || path.dirname(this.configPath);
    this.loadConfig();
  }

  loadConfig(): void {
    if (!existsSync(this.configPath)) {
      this.config = { projects: {} };
      return;
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      const raw = parseYaml(content) || {};
      this.config = ProjectsConfigSchema.parse(raw);
    } catch (err) {
      throw new Error(`Failed to load projects config from '${this.configPath}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  setConfig(config: ProjectsConfig): void {
    this.config = ProjectsConfigSchema.parse(config);
  }

  resolveProject(query: string): ResolvedProject {
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('Project query must be a non-empty string.');
    }

    const normalizedQuery = query.trim().toLowerCase();
    const projects = this.config.projects;

    // 1. Direct ID match (case-insensitive)
    for (const [id, cfg] of Object.entries(projects)) {
      if (id.toLowerCase() === normalizedQuery) {
        const resolvedRoot = path.isAbsolute(cfg.root)
          ? path.normalize(cfg.root)
          : path.resolve(this.basePath, cfg.root);

        return {
          projectId: id,
          name: cfg.name,
          root: resolvedRoot,
          config: cfg,
        };
      }
    }

    // 2. Alias match (case-insensitive)
    for (const [id, cfg] of Object.entries(projects)) {
      const aliases = cfg.aliases || [];
      for (const alias of aliases) {
        if (alias.toLowerCase() === normalizedQuery) {
          const resolvedRoot = path.isAbsolute(cfg.root)
            ? path.normalize(cfg.root)
            : path.resolve(this.basePath, cfg.root);

          return {
            projectId: id,
            name: cfg.name,
            root: resolvedRoot,
            config: cfg,
          };
        }
      }
    }

    const available = Object.keys(projects);
    throw new Error(
      `Project '${query}' not found in configuration. Available project IDs: [${available.join(', ') || 'none'}]. Please configure it in config/projects.yaml.`
    );
  }

  listProjects(): ResolvedProject[] {
    return Object.entries(this.config.projects).map(([id, cfg]) => {
      const resolvedRoot = path.isAbsolute(cfg.root)
        ? path.normalize(cfg.root)
        : path.resolve(this.basePath, cfg.root);

      return {
        projectId: id,
        name: cfg.name,
        root: resolvedRoot,
        config: cfg,
      };
    });
  }
}

export const defaultProjectResolver = new ProjectResolver();
