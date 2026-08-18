import { defaultProjectResolver } from '../src/project/project-resolver.js';
import { ContextLoader } from '../src/project/context-loader.js';
import { executeSoftwareDevelopmentLoop } from '../src/mastra/workflows/software-development.js';
import { InternalTask } from '../src/task/schema/task.schema.js';

async function main() {
  const args = process.argv.slice(2);
  let projectId = 'demo';
  let title = '检查工程状态并修复问题';
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

  console.log(`\n==================================================`);
  console.log(`🚀 [AI Engineering Core] 正在解析目标工程：'${projectId}'...`);
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

  console.log(`📌 任务创建成功：${task.id}`);
  console.log(`📝 需求标题：${title}`);
  console.log(`📂 工程根目录：${projectContext.projectRoot}`);
  console.log(`⚙️ 执行模式：${task.mode} | 优先级：${task.priority}`);
  console.log(`--------------------------------------------------`);
  console.log(`⚡ 正在启动 Mastra 多模型软件工程编排流水线...`);

  const result = await executeSoftwareDevelopmentLoop(task, projectContext);

  console.log(`--------------------------------------------------`);
  console.log(`✨ 任务执行结束！最终状态：[${result.status}]`);
  console.log(`🔄 迭代修复轮次：${result.rounds} 轮`);
  if (result.finalReview) {
    console.log(`🔍 最终 Review 结论：${result.finalReview.result}（${result.finalReview.summary || '无附带摘要'}）`);
    if (result.finalReview.issues && result.finalReview.issues.length > 0) {
      console.log(`⚠️ 遗留 Issue 数量：${result.finalReview.issues.length} 个`);
    }
  }
  if (result.arbitration) {
    console.log(`⚖️ 架构师仲裁决策：${result.arbitration.decision}`);
  }
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error('\n❌ 任务执行异常失败：', err);
  process.exit(1);
});
