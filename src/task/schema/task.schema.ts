import { z } from 'zod';
import { TaskStatusSchema } from '../state/task-state.js';
import { ReviewResultSchema } from './review-issue.schema.js';
import { TimelineEventSchema } from './timeline.schema.js';

export const TaskSourceSchema = z.object({
  type: z.enum(['manual', 'feishu', 'jira', 'github_issue', 'webhook']),
  externalId: z.string().nullable().default(null),
  sync: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TaskSource = z.infer<typeof TaskSourceSchema>;

export const TaskProjectRefSchema = z.object({
  id: z.string(),
  root: z.string().optional(),
});
export type TaskProjectRef = z.infer<typeof TaskProjectRefSchema>;

export const TaskRequirementSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  constraints: z.array(z.string()).default([]),
});
export type TaskRequirement = z.infer<typeof TaskRequirementSchema>;

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskModeSchema = z.enum(['fast', 'standard', 'strict', 'auto']);
export type TaskMode = z.infer<typeof TaskModeSchema>;

export const TaskAnalysisSchema = z.object({
  type: z.string().nullable().default(null),
  complexity: z.enum(['low', 'medium', 'high']).nullable().default(null),
  risk: z.enum(['low', 'medium', 'high']).nullable().default(null),
  summary: z.string().optional(),
});
export type TaskAnalysis = z.infer<typeof TaskAnalysisSchema>;

export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  targetFiles: z.array(z.string()).optional(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const TaskPlanSchema = z
  .object({
    steps: z.array(PlanStepSchema).default([]),
    summary: z.string().optional(),
  })
  .nullable()
  .default(null);
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const FileChangeSchema = z.object({
  file: z.string(),
  type: z.enum(['add', 'modify', 'delete']),
  description: z.string().optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

export const TaskExecutionSchema = z.object({
  round: z.number().int().nonnegative().default(0),
  changes: z.array(FileChangeSchema).default([]),
});
export type TaskExecution = z.infer<typeof TaskExecutionSchema>;

export const VerificationResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().int(),
  stdout: z.string().default(''),
  stderr: z.string().default(''),
  durationMs: z.number().nonnegative().optional(),
  success: z.boolean(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const TaskVerificationSchema = z.object({
  results: z.array(VerificationResultSchema).default([]),
});
export type TaskVerification = z.infer<typeof TaskVerificationSchema>;

export const TaskArbitrationSchema = z
  .object({
    decision: z.enum(['PROCEED', 'RETRY_DEVELOPER', 'CANCEL', 'MANUAL_INTERVENTION']),
    feedback: z.string().optional(),
    arbitratedAt: z.string().datetime().optional(),
  })
  .nullable()
  .default(null);
export type TaskArbitration = z.infer<typeof TaskArbitrationSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  source: TaskSourceSchema,
  project: TaskProjectRefSchema,
  requirement: TaskRequirementSchema,
  priority: TaskPrioritySchema.default('normal'),
  mode: TaskModeSchema.default('auto'),
  status: TaskStatusSchema.default('CREATED'),
  analysis: TaskAnalysisSchema.default({
    type: null,
    complexity: null,
    risk: null,
  }),
  plan: TaskPlanSchema,
  execution: TaskExecutionSchema.default({
    round: 0,
    changes: [],
  }),
  verification: TaskVerificationSchema.default({
    results: [],
  }),
  review: ReviewResultSchema.default({
    round: 0,
    result: null,
    issues: [],
  }),
  arbitration: TaskArbitrationSchema,
  timeline: z.array(TimelineEventSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;
