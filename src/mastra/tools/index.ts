import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runBuildTool, runLintTool, runTestTool } from '../../tools/verification-tools.js';
import { RoleSchema } from '../../executors/schema/executor.schema.js';
import { ProjectContextSchema } from '../../project/schema/project.schema.js';

export const testTool = createTool({
  id: 'test-tool',
  description: 'Execute project test suite using real verification tool.',
  inputSchema: z.object({
    role: RoleSchema,
    projectContext: ProjectContextSchema,
    command: z.string().optional(),
  }),
  outputSchema: z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    success: z.boolean(),
  }),
  execute: async (inputData) => {
    return await runTestTool(inputData.role, inputData.projectContext, inputData.command);
  },
});

export const lintTool = createTool({
  id: 'lint-tool',
  description: 'Execute project linter using real verification tool.',
  inputSchema: z.object({
    role: RoleSchema,
    projectContext: ProjectContextSchema,
    command: z.string().optional(),
  }),
  outputSchema: z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    success: z.boolean(),
  }),
  execute: async (inputData) => {
    return await runLintTool(inputData.role, inputData.projectContext, inputData.command);
  },
});

export const buildTool = createTool({
  id: 'build-tool',
  description: 'Execute project build command using real verification tool.',
  inputSchema: z.object({
    role: RoleSchema,
    projectContext: ProjectContextSchema,
    command: z.string().optional(),
  }),
  outputSchema: z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number(),
    success: z.boolean(),
  }),
  execute: async (inputData) => {
    return await runBuildTool(inputData.role, inputData.projectContext, inputData.command);
  },
});

export * from '../../tools/index.js';
