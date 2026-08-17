import { defaultProjectResolver } from '../src/project/project-resolver.js';
import { ContextLoader } from '../src/project/context-loader.js';
import { executeSoftwareDevelopmentLoop } from '../src/mastra/workflows/software-development.js';
import { InternalTask } from '../src/task/schema/task.schema.js';

async function main() {
  const args = process.argv.slice(2);
  let projectId = 'comfyui';
  let title = 'Check project status and fix issues';
  let description = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' || args[i] === '-p') {
      projectId = args[++i];
    } else if (args[i] === '--title' || args[i] === '-t') {
      title = args[++i];
    } else if (args[i] === '--description' || args[i] === '-d') {
      description = args[++i];
    }
  }

  console.log(`🚀 Resolving project '${projectId}'...`);
  defaultProjectResolver.loadConfig();
  const resolvedProject = defaultProjectResolver.resolveProject(projectId);
  const projectContext = ContextLoader.loadContext(resolvedProject);

  const nowIso = new Date().toISOString();
  const task: InternalTask = {
    id: `TASK-${Date.now()}`,
    source: { type: 'manual', externalId: null, sync: false },
    project: { id: resolvedProject.projectId, root: projectContext.projectRoot },
    requirement: { title, description, constraints: [] },
    priority: 'normal',
    mode: 'auto',
    status: 'CREATED',
    analysis: {},
    plan: null,
    execution: { round: 0, changes: [] },
    verification: { results: [] },
    review: { round: 0, result: null, issues: [] },
    arbitration: null,
    timeline: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  console.log(`📌 Starting Task '${task.id}': ${title}`);
  console.log(`📂 Project Root: ${projectContext.projectRoot}`);
  console.log(`--------------------------------------------------`);

  const result = await executeSoftwareDevelopmentLoop(task, projectContext);

  console.log(`--------------------------------------------------`);
  console.log(`✨ Task Finished! Final Status: [${result.status}]`);
  console.log(`🔄 Total Rounds: ${result.rounds}`);
  if (result.finalReview) {
    console.log(`🔍 Review Outcome: ${result.finalReview.result} (${result.finalReview.summary || ''})`);
  }
}

main().catch((err) => {
  console.error('❌ Task execution failed:', err);
  process.exit(1);
});
