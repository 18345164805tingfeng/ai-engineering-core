import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  ProjectCommands,
  ProjectContext,
  ProjectContextSchema,
  ProjectGitStatus,
  ProjectManifest,
} from './schema/project.schema.js';
import { ResolvedProject } from './project-resolver.js';

export interface ContextLoaderOptions {
  includeGitStatus?: boolean;
  maxReadmeLength?: number;
  maxAgentsDocLength?: number;
}

export class ContextLoader {
  static loadContext(project: ResolvedProject, options?: ContextLoaderOptions): ProjectContext {
    const root = project.root;
    if (!existsSync(root)) {
      throw new Error(`Project root directory does not exist: '${root}'`);
    }

    const agentsDoc = this.loadAgentsDoc(root, options?.maxAgentsDocLength);
    const readmeDoc = this.loadReadmeDoc(root, options?.maxReadmeLength);
    const projectYaml = this.loadProjectYaml(root);
    const manifest = this.loadManifest(root);
    const git = options?.includeGitStatus !== false ? this.loadGitStatus(root) : {
      isGitRepo: false,
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    };
    const commands = this.inferCommands(manifest, project.config.commands);
    const dirSummary = this.getDirSummary(root);

    const context: ProjectContext = {
      projectId: project.projectId,
      projectName: project.name,
      projectRoot: root,
      agentsDoc,
      readmeDoc,
      projectYaml,
      manifest,
      git,
      commands,
      dirSummary,
      loadedAt: new Date().toISOString(),
    };

    return ProjectContextSchema.parse(context);
  }

  private static loadAgentsDoc(root: string, maxLength = 10000): string | null {
    const candidatePaths = [
      path.join(root, 'AGENTS.md'),
      path.join(root, 'agents.md'),
      path.join(root, '.agents', 'AGENTS.md'),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p) && statSync(p).isFile()) {
        try {
          const content = readFileSync(p, 'utf-8');
          return content.length > maxLength ? content.slice(0, maxLength) + '\n... (truncated)' : content;
        } catch {
          // ignore error and continue
        }
      }
    }
    return null;
  }

  private static loadReadmeDoc(root: string, maxLength = 10000): string | null {
    const candidatePaths = [
      path.join(root, 'README.md'),
      path.join(root, 'readme.md'),
      path.join(root, 'README'),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p) && statSync(p).isFile()) {
        try {
          const content = readFileSync(p, 'utf-8');
          return content.length > maxLength ? content.slice(0, maxLength) + '\n... (truncated)' : content;
        } catch {
          // ignore error and continue
        }
      }
    }
    return null;
  }

  private static loadProjectYaml(root: string): string | null {
    const candidatePaths = [
      path.join(root, '.ai', 'project.yaml'),
      path.join(root, '.ai', 'project.yml'),
      path.join(root, 'project.yaml'),
      path.join(root, 'project.yml'),
    ];

    for (const p of candidatePaths) {
      if (existsSync(p) && statSync(p).isFile()) {
        try {
          return readFileSync(p, 'utf-8');
        } catch {
          // ignore error
        }
      }
    }
    return null;
  }

  private static loadManifest(root: string): ProjectManifest {
    // 1. Node.js project
    const pkgPath = path.join(root, 'package.json');
    if (existsSync(pkgPath) && statSync(pkgPath).isFile()) {
      try {
        const content = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        return {
          type: 'node',
          name: pkg.name,
          version: pkg.version,
          dependencies: Object.keys(pkg.dependencies || {}),
          devDependencies: Object.keys(pkg.devDependencies || {}),
          scripts: pkg.scripts || {},
        };
      } catch {
        // malformed package.json
      }
    }

    // 2. Java project
    if (existsSync(path.join(root, 'pom.xml'))) {
      return {
        type: 'java',
        dependencies: [],
        devDependencies: [],
        scripts: {
          test: 'mvn test',
          build: 'mvn package',
        },
      };
    }

    // 3. Python project
    if (existsSync(path.join(root, 'pyproject.toml')) || existsSync(path.join(root, 'requirements.txt'))) {
      return {
        type: 'python',
        dependencies: [],
        devDependencies: [],
        scripts: {
          test: 'pytest',
        },
      };
    }

    // 4. Rust project
    if (existsSync(path.join(root, 'Cargo.toml'))) {
      return {
        type: 'rust',
        dependencies: [],
        devDependencies: [],
        scripts: {
          test: 'cargo test',
          build: 'cargo build',
        },
      };
    }

    // 5. Go project
    if (existsSync(path.join(root, 'go.mod'))) {
      return {
        type: 'go',
        dependencies: [],
        devDependencies: [],
        scripts: {
          test: 'go test ./...',
          build: 'go build ./...',
        },
      };
    }

    return {
      type: 'unknown',
      dependencies: [],
      devDependencies: [],
      scripts: {},
    };
  }

  private static loadGitStatus(root: string): ProjectGitStatus {
    try {
      const isGit = execSync('git rev-parse --is-inside-work-tree', {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
        .toString()
        .trim();

      if (isGit !== 'true') {
        return { isGitRepo: false, isClean: true, modifiedFiles: [], untrackedFiles: [] };
      }

      let branch: string | undefined;
      try {
        branch = execSync('git branch --show-current', {
          cwd: root,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        })
          .toString()
          .trim();
      } catch {
        // detached HEAD or empty repo
      }

      let headCommit: string | undefined;
      try {
        headCommit = execSync('git rev-parse HEAD', {
          cwd: root,
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        })
          .toString()
          .trim();
      } catch {
        // initial commit
      }

      const statusOutput = execSync('git status --porcelain', {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
        .toString()
        .trim();

      const modifiedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      if (statusOutput) {
        const lines = statusOutput.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const status = trimmed.slice(0, 2);
          const file = trimmed.slice(2).trim();
          if (status.includes('?')) {
            untrackedFiles.push(file);
          } else {
            modifiedFiles.push(file);
          }
        }
      }

      return {
        isGitRepo: true,
        branch,
        headCommit,
        isClean: modifiedFiles.length === 0 && untrackedFiles.length === 0,
        modifiedFiles,
        untrackedFiles,
      };
    } catch {
      return { isGitRepo: false, isClean: true, modifiedFiles: [], untrackedFiles: [] };
    }
  }

  private static inferCommands(manifest: ProjectManifest, configured?: ProjectCommands): ProjectCommands {
    const commands: ProjectCommands = { ...configured };

    if (!commands.test && manifest.scripts.test) {
      commands.test = manifest.type === 'node' ? 'npm test' : manifest.scripts.test;
    }
    if (!commands.build && manifest.scripts.build) {
      commands.build = manifest.type === 'node' ? 'npm run build' : manifest.scripts.build;
    }
    if (!commands.lint && manifest.scripts.lint) {
      commands.lint = manifest.type === 'node' ? 'npm run lint' : manifest.scripts.lint;
    }
    if (!commands.dev && manifest.scripts.dev) {
      commands.dev = manifest.type === 'node' ? 'npm run dev' : manifest.scripts.dev;
    }
    if (!commands.typeCheck && (manifest.scripts['type-check'] || manifest.scripts.typecheck)) {
      commands.typeCheck = manifest.scripts['type-check'] ? 'npm run type-check' : 'npm run typecheck';
    }

    return commands;
  }

  private static getDirSummary(root: string): string[] {
    try {
      const entries = readdirSync(root, { withFileTypes: true });
      const ignored = new Set(['node_modules', '.git', 'dist', 'target', 'vendor', '.next', '.nuxt', '.mastra']);

      return entries
        .filter(entry => !ignored.has(entry.name) && !entry.name.startsWith('.'))
        .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    } catch {
      return [];
    }
  }
}
