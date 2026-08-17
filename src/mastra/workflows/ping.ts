import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

export const pingStep = createStep({
  id: 'ping-step',
  inputSchema: z.object({
    message: z.string().default('ping'),
  }),
  outputSchema: z.object({
    reply: z.string(),
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    const message = inputData?.message ?? 'ping';
    return {
      reply: `pong: ${message}`,
      timestamp: new Date().toISOString(),
    };
  },
});

export const pingWorkflow = createWorkflow({
  id: 'ping-workflow',
  inputSchema: z.object({
    message: z.string().default('ping'),
  }),
  outputSchema: z.object({
    reply: z.string(),
    timestamp: z.string(),
  }),
})
  .then(pingStep)
  .commit();
