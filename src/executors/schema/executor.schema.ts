import { z } from 'zod';
import { TaskSchema } from '../../task/schema/task.schema.js';
import { ProjectContextSchema } from '../../project/schema/project.schema.js';

export const RoleSchema = z.enum([
  'router',
  'planner',
  'developer',
  'reviewer',
  'tester',
  'architect',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ExecutorTypeSchema = z.enum(['agent', 'model']);
export type ExecutorType = z.infer<typeof ExecutorTypeSchema>;

export const ExecutorHealthStatusSchema = z.enum([
  'HEALTHY',
  'DEGRADED',
  'UNAVAILABLE',
  'CIRCUIT_OPEN',
]);
export type ExecutorHealthStatus = z.infer<typeof ExecutorHealthStatusSchema>;

export const ExecutorCapabilitiesSchema = z.object({
  read: z.boolean().default(true),
  write: z.boolean().default(false),
  shell: z.boolean().default(false),
  git: z.boolean().default(false),
  test: z.boolean().default(false),
  structuredOutput: z.boolean().default(true),
});
export type ExecutorCapabilities = z.infer<typeof ExecutorCapabilitiesSchema>;

export const ExecutorHealthSchema = z.object({
  executorId: z.string(),
  status: ExecutorHealthStatusSchema,
  consecutiveFailures: z.number().int().nonnegative().default(0),
  latencyMs: z.number().nonnegative().optional(),
  lastSuccessAt: z.string().datetime().optional(),
  lastFailureAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
  circuit: z.enum(['closed', 'open', 'half-open']).default('closed'),
});
export type ExecutorHealth = z.infer<typeof ExecutorHealthSchema>;

export const ExecutionRequestSchema = z.object({
  role: RoleSchema,
  task: TaskSchema,
  projectContext: ProjectContextSchema,
  prompt: z.string().optional(),
  instruction: z.string().optional(),
  contextData: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().positive().default(60000),
});
export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;

export const ExecutionResponseSchema = z.object({
  success: z.boolean(),
  output: z.unknown(),
  structuredResult: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
  executorId: z.string(),
  role: RoleSchema,
});
export type ExecutionResponse = z.infer<typeof ExecutionResponseSchema>;

export const RoleMappingSchema = z.object({
  primary: z.string(),
  fallback: z.array(z.string()).default([]),
});
export type RoleMapping = z.infer<typeof RoleMappingSchema>;

export const RolesConfigSchema = z.object({
  roles: z.record(RoleSchema, RoleMappingSchema),
});
export type RolesConfig = z.infer<typeof RolesConfigSchema>;

export const ExecutorConfigItemSchema = z.object({
  type: ExecutorTypeSchema,
  provider: z.string(),
  model: z.string().optional(),
  agent: z.string().optional(),
  description: z.string().optional(),
});
export type ExecutorConfigItem = z.infer<typeof ExecutorConfigItemSchema>;

export const ExecutorsConfigSchema = z.object({
  executors: z.record(z.string(), ExecutorConfigItemSchema),
});
export type ExecutorsConfig = z.infer<typeof ExecutorsConfigSchema>;
