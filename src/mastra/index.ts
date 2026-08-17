import { Mastra } from '@mastra/core';
import { pingWorkflow, softwareDevelopmentWorkflow } from './workflows/index.js';

export const mastra = new Mastra({
  workflows: {
    pingWorkflow,
    softwareDevelopmentWorkflow,
  },
});

export * from './workflows/index.js';
export * from './tools/index.js';