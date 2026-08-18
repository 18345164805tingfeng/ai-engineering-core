import { z } from 'zod';

export const StepStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'SKIPPED',
  'CANCELLED',
]);

export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepResultSchema = z.object({
  id: z.string(),
  status: StepStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  durationMs: z.number().nonnegative().optional(),
  executor: z.string().optional(),
  model: z.string().optional(),
  summary: z.string().optional(),
  artifactIds: z.array(z.string()).default([]),
  error: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type StepResult = z.infer<typeof StepResultSchema>;

export const WorkflowRunInfoSchema = z.object({
  workflowId: z.string().default('software-development'),
  runId: z.string().nullable().default(null),
  currentStep: z.string().nullable().default(null),
});

export type WorkflowRunInfo = z.infer<typeof WorkflowRunInfoSchema>;

export const TaskWorkspaceSchema = z.object({
  id: z.string().nullable().default(null),
  mode: z.enum(['shared-lock', 'git-worktree']).default('shared-lock'),
  root: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  baseBranch: z.string().nullable().default(null),
});

export type TaskWorkspace = z.infer<typeof TaskWorkspaceSchema>;

export const TaskSchedulingStatusSchema = z.enum([
  'READY',
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_WORKSPACE',
  'WAITING_FOR_EXECUTOR',
]);

export type TaskSchedulingStatus = z.infer<typeof TaskSchedulingStatusSchema>;

export const TaskSchedulingSchema = z.object({
  status: TaskSchedulingStatusSchema.default('READY'),
  queuedAt: z.string().datetime().nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  waitingReason: z.string().nullable().default(null),
});

export type TaskScheduling = z.infer<typeof TaskSchedulingSchema>;
