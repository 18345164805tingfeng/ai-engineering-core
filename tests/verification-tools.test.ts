import { describe, it, expect } from 'vitest';
import { ProjectContext } from '../src/project/schema/project.schema.js';
import {
  runProcess,
  checkToolPermission,
  runTestTool,
  runLintTool,
  runBuildTool,
  VerificationToolError,
} from '../src/tools/index.js';

describe('Verification Tools & Process Engine', () => {
  const dummyContext: ProjectContext = {
    projectId: 'demo',
    projectName: 'Demo Project',
    projectRoot: process.cwd(),
    agentsDoc: null,
    readmeDoc: null,
    projectYaml: null,
    manifest: {
      type: 'node',
      name: 'demo',
      version: '1.0.0',
      dependencies: [],
      devDependencies: [],
      scripts: {},
    },
    git: {
      isGitRepo: true,
      branch: 'main',
      headCommit: 'abc1234',
      isClean: true,
      modifiedFiles: [],
      untrackedFiles: [],
    },
    dirSummary: [],
    commands: {
      test: 'npm test',
      lint: 'npm run lint',
      build: 'npm run build',
    },
    loadedAt: new Date().toISOString(),
  };

  describe('Process Engine (runProcess)', () => {
    it('should execute process successfully with customRunner', async () => {
      const res = await runProcess('echo hello', {
        customRunner: async (cmd) => ({
          command: cmd,
          exitCode: 0,
          stdout: 'hello\n',
          stderr: '',
          durationMs: 10,
          success: true,
        }),
      });

      expect(res.success).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe('hello\n');
      expect(res.durationMs).toBeGreaterThan(0);
    });

    it('should return failure result when process exits with non-zero code', async () => {
      const res = await runProcess('invalid-command-xyz', {
        customRunner: async (cmd) => ({
          command: cmd,
          exitCode: 127,
          stdout: '',
          stderr: 'command not found',
          durationMs: 15,
          success: false,
        }),
      });

      expect(res.success).toBe(false);
      expect(res.exitCode).toBe(127);
      expect(res.stderr).toBe('command not found');
    });
  });

  describe('Role Permission Matrix', () => {
    it('should allow developer full permissions', () => {
      expect(checkToolPermission('developer', 'read')).toBe(true);
      expect(checkToolPermission('developer', 'write')).toBe(true);
      expect(checkToolPermission('developer', 'shell')).toBe(true);
      expect(checkToolPermission('developer', 'test')).toBe(true);
      expect(checkToolPermission('developer', 'lint')).toBe(true);
      expect(checkToolPermission('developer', 'build')).toBe(true);
    });

    it('should restrict reviewer write/shell while allowing test/lint/build', () => {
      expect(checkToolPermission('reviewer', 'read')).toBe(true);
      expect(checkToolPermission('reviewer', 'write')).toBe(false);
      expect(checkToolPermission('reviewer', 'shell')).toBe(false);
      expect(checkToolPermission('reviewer', 'test')).toBe(true);
      expect(checkToolPermission('reviewer', 'lint')).toBe(true);
      expect(checkToolPermission('reviewer', 'build')).toBe(true);
    });

    it('should deny planner and architect from running tests', () => {
      expect(checkToolPermission('planner', 'test')).toBe(false);
      expect(checkToolPermission('architect', 'test')).toBe(false);
    });
  });

  describe('Verification Tools Execution', () => {
    it('should run TestTool for developer role', async () => {
      const res = await runTestTool('developer', dummyContext, undefined, {
        customRunner: async (cmd) => ({
          command: cmd,
          exitCode: 0,
          stdout: '10 tests passed',
          stderr: '',
          durationMs: 50,
          success: true,
        }),
      });

      expect(res.command).toBe('npm test');
      expect(res.success).toBe(true);
      expect(res.stdout).toContain('10 tests passed');
    });

    it('should throw VerificationToolError when role is not permitted', async () => {
      await expect(
        runTestTool('planner', dummyContext, undefined, {
          customRunner: async (cmd) => ({
            command: cmd,
            exitCode: 0,
            stdout: '',
            stderr: '',
            durationMs: 5,
            success: true,
          }),
        })
      ).rejects.toThrow(VerificationToolError);
    });

    it('should run LintTool and BuildTool correctly', async () => {
      const lintRes = await runLintTool('developer', dummyContext, undefined, {
        customRunner: async (cmd) => ({
          command: cmd,
          exitCode: 0,
          stdout: 'No lint errors',
          stderr: '',
          durationMs: 20,
          success: true,
        }),
      });
      expect(lintRes.command).toBe('npm run lint');
      expect(lintRes.success).toBe(true);

      const buildRes = await runBuildTool('reviewer', dummyContext, undefined, {
        customRunner: async (cmd) => ({
          command: cmd,
          exitCode: 0,
          stdout: 'Build complete',
          stderr: '',
          durationMs: 100,
          success: true,
        }),
      });
      expect(buildRes.command).toBe('npm run build');
      expect(buildRes.success).toBe(true);
    });
  });
});
