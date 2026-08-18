import { Mastra } from '@mastra/core';
import { pingWorkflow, softwareDevelopmentWorkflow } from './workflows/index.js';
import { taskApiRoutes } from './routes/task-routes.js';

export const mastra = new Mastra({
  workflows: {
    pingWorkflow,
    softwareDevelopmentWorkflow,
  },
  server: {
    apiRoutes: taskApiRoutes as any,
  },
});

export * from './workflows/index.js';
export * from './tools/index.js';
export * from './routes/index.js';