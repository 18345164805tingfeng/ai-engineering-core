import { z } from 'zod';

export const ReviewSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewCategorySchema = z.enum([
  'correctness',
  'regression',
  'security',
  'performance',
  'concurrency',
  'architecture',
  'maintainability',
  'project-rule',
  'test',
]);
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const ReviewIssueSchema = z.object({
  id: z.string(),
  severity: ReviewSeveritySchema,
  category: ReviewCategorySchema,
  file: z.string(),
  location: z.string().optional(),
  description: z.string(),
  evidence: z.string().optional(),
  suggestion: z.string().optional(),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewResultEnumSchema = z.enum(['PASS', 'FAIL']);
export type ReviewResultEnum = z.infer<typeof ReviewResultEnumSchema>;

export const ReviewResultSchema = z.object({
  round: z.number().int().nonnegative().default(0),
  result: ReviewResultEnumSchema.nullable().default(null),
  summary: z.string().optional(),
  issues: z.array(ReviewIssueSchema).default([]),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const FixItemSchema = z.object({
  issueId: z.string(),
  status: z.enum(['fixed', 'cannot_fix', 'ignored']),
  files: z.array(z.string()).default([]),
  description: z.string(),
});
export type FixItem = z.infer<typeof FixItemSchema>;

export const DeveloperFixResultSchema = z.object({
  fixes: z.array(FixItemSchema).default([]),
});
export type DeveloperFixResult = z.infer<typeof DeveloperFixResultSchema>;
