import { z } from 'zod';

export const TimelineEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string().datetime(),
  executor: z.string().optional(),
  message: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
