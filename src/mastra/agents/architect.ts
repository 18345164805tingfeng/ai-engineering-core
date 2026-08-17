import { ExecutorRouter } from '../../router/executor-router.js';
import { ProjectContext } from '../../project/schema/project.schema.js';
import { Task, TaskArbitration, TaskArbitrationSchema } from '../../task/schema/task.schema.js';
import { ReviewResult } from '../../task/schema/review-issue.schema.js';

export async function runArchitectRole(
  router: ExecutorRouter,
  task: Task,
  projectContext: ProjectContext,
  reviewHistory: ReviewResult[]
): Promise<NonNullable<TaskArbitration>> {
  const prompt = `
You are the Chief AI Software Architect (Arbitrator).
Task Requirement: ${task.requirement.title}
Task ID: ${task.id}
Project: ${projectContext.projectName}

The task has exceeded the maximum review fix rounds (${task.review?.round || 3} rounds).
Review History & Accumulated Issues:
${JSON.stringify(reviewHistory, null, 2)}

Please arbitrate and make a final decision. You MUST output valid JSON:
{
  "decision": "PROCEED" | "RETRY_DEVELOPER" | "CANCEL" | "MANUAL_INTERVENTION",
  "feedback": "Architect arbitration guidance and decision rationale"
}
`.trim();

  const response = await router.executeRole({
    role: 'architect',
    task,
    projectContext,
    prompt,
    contextData: {
      reviewHistory,
    },
  });

  const nowIso = new Date().toISOString();

  if (response.structuredResult) {
    const parsed = TaskArbitrationSchema.safeParse(response.structuredResult);
    if (parsed.success && parsed.data) {
      return {
        ...parsed.data,
        arbitratedAt: parsed.data.arbitratedAt || nowIso,
      };
    }
  }

  if (response.output) {
    try {
      const match = typeof response.output === 'string' ? response.output.match(/\{[\s\S]*\}/) : null;
      if (match) {
        const rawJson = JSON.parse(match[0]);
        const parsed = TaskArbitrationSchema.safeParse(rawJson);
        if (parsed.success && parsed.data) {
          return {
            ...parsed.data,
            arbitratedAt: parsed.data.arbitratedAt || nowIso,
          };
        }
      }
    } catch {
      // Fallback below
    }
  }

  // Default fallback arbitration decision
  return {
    decision: 'RETRY_DEVELOPER',
    feedback: 'Architect default arbitration: Retry developer with explicit final fix instructions.',
    arbitratedAt: nowIso,
  };
}
