import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  ProjectResolver,
  ContextLoader,
  ProjectContextSchema,
  ProjectConfigSchema,
  defaultProjectResolver,
} from '../src/index.js';

describe('Phase 2: Project Context & Resolver', () => {
  let tempDir: string;
  let customConfigFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-core-project-test-'));
    customConfigFile = path.join(tempDir, 'projects.yaml');
  });

  describe('ProjectResolver', () => {
    it('should resolve project by exact ID and aliases', () => {
      const resolver = new ProjectResolver();
      resolver.setConfig({
        projects: {
          myapp: {
            name: 'My Application',
            root: tempDir,
            aliases: ['app', '我的应用', 'MY_APP'],
            commands: {
              test: 'npm test',
            },
          },
        },
      });

      // 1. By ID
      const byId = resolver.resolveProject('myapp');
      expect(byId.projectId).toBe('myapp');
      expect(byId.name).toBe('My Application');
      expect(byId.root).toBe(path.normalize(tempDir));

      // 2. By alias (case-insensitive)
      const byAlias1 = resolver.resolveProject('app');
      expect(byAlias1.projectId).toBe('myapp');

      const byAlias2 = resolver.resolveProject('我的应用');
      expect(byAlias2.projectId).toBe('myapp');

      const byAlias3 = resolver.resolveProject('my_app');
      expect(byAlias3.projectId).toBe('myapp');
    });

    it('should throw clear error when project is not found', () => {
      const resolver = new ProjectResolver();
      resolver.setConfig({
        projects: {
          bi: {
            name: 'BI',
            root: tempDir,
            aliases: ['bi-app'],
          },
        },
      });

      expect(() => resolver.resolveProject('unknown-project')).toThrow(
        /Project 'unknown-project' not found in configuration\. Available project IDs: \[bi\]/
      );
    });

    it('should list all configured projects', () => {
      const resolver = new ProjectResolver();
      resolver.setConfig({
        projects: {
          p1: { name: 'Project 1', root: tempDir, aliases: ['a1'] },
          p2: { name: 'Project 2', root: tempDir, aliases: ['a2'] },
        },
      });

      const list = resolver.listProjects();
      expect(list.length).toBe(2);
      expect(list.map(p => p.projectId)).toEqual(['p1', 'p2']);
    });
  });

  describe('ContextLoader', () => {
    it('should load project context from current ai-engineering-core workspace', () => {
      const workspaceRoot = process.cwd();
      const resolved = {
        projectId: 'core',
        name: 'AI Engineering Core',
        root: workspaceRoot,
        config: {
          name: 'AI Engineering Core',
          root: workspaceRoot,
          aliases: ['core'],
        },
      };

      const context = ContextLoader.loadContext(resolved);

      // Verify schema conformance
      const validated = ProjectContextSchema.parse(context);
      expect(validated.projectId).toBe('core');
      expect(validated.projectName).toBe('AI Engineering Core');
      expect(validated.projectRoot).toBe(workspaceRoot);

      // AGENTS.md should be loaded
      expect(context.agentsDoc).toBeDefined();
      expect(context.agentsDoc).toContain('AI Engineering Core 核心设计与协作原则');

      // Manifest
      expect(context.manifest.type).toBe('node');
      expect(context.manifest.name).toBe('ai-engineering-core');
      expect(context.manifest.dependencies).toContain('@mastra/core');

      // Commands
      expect(context.commands.test).toBe('npm test');
      expect(context.commands.build).toBe('npm run build');
      expect(context.commands.typeCheck).toBe('npm run type-check');

      // Git status
      expect(context.git.isGitRepo).toBe(true);
      expect(context.git.branch).toBeDefined();

      // Dir Summary
      expect(context.dirSummary).toContain('src/');
      expect(context.dirSummary).toContain('package.json');
    });

    it('should load context for mock project with AGENTS.md, README.md, and custom package.json', () => {
      const mockProjectDir = path.join(tempDir, 'mock-app');
      fs.mkdirSync(mockProjectDir);

      fs.writeFileSync(
        path.join(mockProjectDir, 'AGENTS.md'),
        '# Mock Agents Rules\nRule 1: Always write tests.'
      );
      fs.writeFileSync(
        path.join(mockProjectDir, 'README.md'),
        '# Mock App\nA mock application for testing.'
      );
      fs.writeFileSync(
        path.join(mockProjectDir, 'package.json'),
        JSON.stringify({
          name: 'mock-app',
          version: '1.0.0',
          scripts: {
            test: 'vitest',
            lint: 'eslint .',
          },
          dependencies: {
            express: '^4.18.0',
          },
        })
      );

      const resolved = {
        projectId: 'mock',
        name: 'Mock Project',
        root: mockProjectDir,
        config: {
          name: 'Mock Project',
          root: mockProjectDir,
          aliases: ['mock'],
        },
      };

      const context = ContextLoader.loadContext(resolved);

      expect(context.projectId).toBe('mock');
      expect(context.agentsDoc).toBe('# Mock Agents Rules\nRule 1: Always write tests.');
      expect(context.readmeDoc).toBe('# Mock App\nA mock application for testing.');
      expect(context.manifest.type).toBe('node');
      expect(context.manifest.dependencies).toEqual(['express']);
      expect(context.commands.test).toBe('npm test');
      expect(context.commands.lint).toBe('npm run lint');
      expect(context.dirSummary).toContain('package.json');
      expect(context.dirSummary).toContain('AGENTS.md');
      expect(context.dirSummary).toContain('README.md');
    });

    it('should handle non-existent directory gracefully by throwing an error', () => {
      const resolved = {
        projectId: 'non-existent',
        name: 'Missing',
        root: path.join(tempDir, 'does-not-exist'),
        config: {
          name: 'Missing',
          root: path.join(tempDir, 'does-not-exist'),
          aliases: [],
        },
      };

      expect(() => ContextLoader.loadContext(resolved)).toThrow(
        /Project root directory does not exist/
      );
    });
  });

  describe('Default Project Resolver', () => {
    it('should have defaultProjectResolver instance available', () => {
      expect(defaultProjectResolver).toBeDefined();
    });
  });
});
