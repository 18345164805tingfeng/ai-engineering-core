import { ExecutorRouter } from '../../router/executor-router.js';
import { ProjectContext } from '../../project/schema/project.schema.js';
import { Task, TaskPlan, TaskPlanSchema } from '../../task/schema/task.schema.js';

export async function runPlannerRole(
  router: ExecutorRouter,
  task: Task,
  projectContext: ProjectContext
): Promise<TaskPlan> {
  const prompt = `
You are the AI Software Development Planner.
Task Requirement Title: ${task.requirement.title}
Task Description: ${task.requirement.description}
Project: ${projectContext.projectName} (Root: ${projectContext.projectRoot})
Git Branch: ${projectContext.git?.branch || 'main'}

Please analyze the task and output a structured JSON plan for the Developer:
{
  "summary": "High level plan overview",
  "steps": [
    {
      "id": "STEP-1",
      "title": "Step 1 Title",
      "description": "Step 1 detailed instructions",
      "targetFiles": ["src/example.ts"]
    }
  ]
}
`.trim();

  const response = await router.executeRole({
    role: 'planner',
    task,
    projectContext,
    prompt,
  });

  if (response.structuredResult) {
    const parsed = TaskPlanSchema.safeParse(response.structuredResult);
    if (parsed.success && parsed.data) return parsed.data;
  }

  if (response.output) {
    try {
      const match = typeof response.output === 'string' ? response.output.match(/\{[\s\S]*\}/) : null;
      if (match) {
        const rawJson = JSON.parse(match[0]);
        const parsed = TaskPlanSchema.safeParse(rawJson);
        if (parsed.success && parsed.data) return parsed.data;
      }
    } catch {
      // Fallback below
    }
  }

  // Default fallback plan if no valid JSON output generated
  return {
    summary: `Plan for ${task.requirement.title}`,
    steps: [
      {
        id: 'STEP-1',
        title: `Implement ${task.requirement.title}`,
        description: task.requirement.description || 'Fulfill requirement',
      },
    ],
  };
}
