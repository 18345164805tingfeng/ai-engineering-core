import { Mastra } from '@mastra/core';
import { pingWorkflow } from './workflows/index.js';

export const mastra = new Mastra({
  workflows: {
    pingWorkflow,
  },
});

export * from './workflows/index.js';