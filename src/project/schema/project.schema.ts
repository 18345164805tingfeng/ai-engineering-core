import { z } from 'zod';

export const ProjectCommandsSchema = z.object({
  build: z.string().optional(),
  test: z.string().optional(),
  lint: z.string().optional(),
  dev: z.string().optional(),
  typeCheck: z.string().optional(),
});
export type ProjectCommands = z.infer<typeof ProjectCommandsSchema>;

export const ProjectConfigSchema = z.object({
  name: z.string(),
  root: z.string(),
  aliases: z.array(z.string()).default([]),
  commands: ProjectCommandsSchema.optional(),
  description: z.string().optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const ProjectsConfigSchema = z.object({
  projects: z.record(z.string(), ProjectConfigSchema),
});
export type ProjectsConfig = z.infer<typeof ProjectsConfigSchema>;

export const ProjectManifestSchema = z.object({
  type: z.enum(['node', 'java', 'python', 'go', 'rust', 'unknown']),
  name: z.string().optional(),
  version: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  devDependencies: z.array(z.string()).default([]),
  scripts: z.record(z.string(), z.string()).default({}),
});
export type ProjectManifest = z.infer<typeof ProjectManifestSchema>;

export const ProjectGitStatusSchema = z.object({
  isGitRepo: z.boolean(),
  branch: z.string().optional(),
  headCommit: z.string().optional(),
  isClean: z.boolean().default(true),
  modifiedFiles: z.array(z.string()).default([]),
  untrackedFiles: z.array(z.string()).default([]),
});
export type ProjectGitStatus = z.infer<typeof ProjectGitStatusSchema>;

export const ProjectContextSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  projectRoot: z.string(),
  agentsDoc: z.string().nullable().default(null),
  readmeDoc: z.string().nullable().default(null),
  projectYaml: z.string().nullable().default(null),
  manifest: ProjectManifestSchema,
  git: ProjectGitStatusSchema,
  commands: ProjectCommandsSchema,
  dirSummary: z.array(z.string()).default([]),
  loadedAt: z.string().datetime(),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
