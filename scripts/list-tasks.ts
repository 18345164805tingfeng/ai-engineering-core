import { defaultTaskStore } from '../src/task/store/task-store.js';

async function main() {
  const tasks = await defaultTaskStore.listTasks();
  console.log(`\n==================================================`);
  console.log(`📋 AI Engineering Core - 历史任务列表 (共 ${tasks.length} 条记录)`);
  console.log(`==================================================\n`);

  if (tasks.length === 0) {
    console.log(`（暂无历史任务记录）`);
    return;
  }

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    console.log(`[${i + 1}] 任务 ID: ${t.id}`);
    console.log(`    📌 标题: ${t.requirement?.title || '（未命名）'}`);
    console.log(`    📂 项目: ${t.project?.id} (${t.project?.root})`);
    console.log(`    🚦 状态: ${t.status}`);
    console.log(`    📅 创建时间: ${t.createdAt}`);
    console.log(`    🔄 Timeline 事件数: ${t.timeline?.length || 0}`);
    if (t.review?.result) {
      console.log(`    🔍 Review 结论: ${t.review.result}`);
    }
    console.log(`--------------------------------------------------`);
  }
}

main().catch((err) => {
  console.error('❌ Failed to list tasks:', err);
  process.exit(1);
});
