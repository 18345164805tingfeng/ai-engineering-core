import { describe, it, expect } from 'vitest';
import { mastra } from '../src/mastra/index.js';

describe('Mastra Core Initialization & Workflow Execution', () => {
  it('should successfully initialize the Mastra instance', () => {
    expect(mastra).toBeDefined();
  });

  it('should retrieve registered workflows from Mastra', () => {
    const workflow = mastra.getWorkflow('pingWorkflow');
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('ping-workflow');
  });

  it('should successfully execute the ping workflow via createRun and produce valid output', async () => {
    const workflow = mastra.getWorkflow('pingWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        message: 'hello ai-core',
      },
    });

    expect(result).toBeDefined();
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result).toBeDefined();
      expect(result.result.reply).toBe('pong: hello ai-core');
      expect(result.result.timestamp).toBeDefined();
      expect(result.steps['ping-step']?.status).toBe('success');
      expect(result.steps['ping-step']?.output?.reply).toBe('pong: hello ai-core');
    }
  });
});
