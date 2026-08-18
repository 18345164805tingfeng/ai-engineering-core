# AI Engineering Core (多模型软件工程编排系统)

<p align="center">
  <b>基于 Mastra 的企业级多模型/多 Agent 软件开发、测试、评审与修复全链路闭环系统</b>
</p>

---

## 🌟 核心特性与架构原则

1. **Mastra 编排与业务解耦**：
   - 工作流引擎只调用固定角色（`Planner`、`Developer`、`Tester`、`Reviewer`、`Architect`），绝不硬编码绑定具体大模型或 Agent。
2. **11 个原子工作流步骤（Workflow Decomposition）**：
   - `load-context` ➔ `analyze-task` ➔ `plan-task` ➔ `acquire-workspace` ➔ `develop` ➔ `verify` ➔ `review` ➔ `fix loop` ➔ `arbitrate` ➔ `finalize` ➔ `release-workspace`
3. **真实证据裁决与完成门禁（Completion Gate）**：
   - 真实工具执行结果（ExitCode, stdout, stderr）作为最高证据。
   - `VerificationClassifier` 智能分类（`PASSED`, `FAILED_CODE`, `FAILED_ENVIRONMENT`, `BLOCKED_SANDBOX`, `BLOCKED_PERMISSION`, `TIMEOUT`）。
   - 环境缺失或沙箱阻断时严禁标记为完成（收敛至 `BLOCKED`），禁止将环境问题交由 Developer 改写业务代码。
4. **安全并发与工作区排他锁（Safe Concurrency & Project Lock）**：
   - **跨项目并发**：不同工程（Project A 与 Project B）完全并行执行。
   - **同项目互斥**：相同项目通过 `ProjectLockManager` 排他锁定，防止代码脏写、Git Diff 污染与测试并发干扰；后续任务进入 `waitingQueue` 自动排队。
   - **执行器槽位限制**：`ExecutorConcurrencyManager` 控制单 GPU 本地模型（如 Ollama）并发数，防止显存溢出。
5. **多任务与多 Run 隔离（Multiple Workflow Runs）**：
   - 每一任务配备唯一 `workflow.runId` 与独立 `AbortController`，取消任务不影响其他任务，时间线与步骤完全隔离。
6. **三层安全沙箱防护（Security Guards）**：
   - `ProjectPathGuard`：防范路径穿越（`..`）与软链接（Symlink）逃逸。
   - `ProcessCommandGuard`：三级风险控制（`SAFE` / `APPROVAL_REQUIRED` / `DENIED`），拦截破坏性命令。
   - `SecretRedactor`：API Key、Bearer Token、密码及环境变量全局深度脱敏。
7. **精简审计时间线与制品存储（Timeline & ArtifactStore）**：
   - 时间线记录核心事件摘要与 `artifactId` 引用，完整测试日志、Diff 与 Review 报告存入 `ArtifactStore` 并脱敏保存。
8. **原生 REST API 与中文可视化控制台**：
   - 基于 Mastra `server.apiRoutes` 暴露标准端点。
   - 内置深空暗色玻璃拟态（Glassmorphism）中文控制台页面（`/` 与 `/dashboard`）。

---

## 🏗️ 目录结构

```text
ai-engineering-core/
├── config/
│   ├── projects.yaml          # 多工程项目定义与别名配置
│   └── roles.yaml             # 角色到执行器的路由映射策略
├── docs/                      # 需求说明书、实施计划与架构提示词
├── scripts/
│   ├── run-task.ts            # 命令行任务快速启动与全流程执行脚本
│   └── list-tasks.ts          # 历史任务查看与过滤脚本
├── src/
│   ├── executors/             # AgentProvider 与 ModelProvider (Codex, Antigravity, Ollama, Mock)
│   ├── gateway/               # 统一任务接入网关、幂等性去重与标准化
│   ├── mastra/
│   │   ├── public/index.html  # 中文 Web 控制台页面
│   │   ├── routes/            # 原生 REST API 路由控制器
│   │   ├── steps/             # 11 个原子 Mastra Steps
│   │   └── workflows/         # 软件工程编排流水线定义
│   ├── project/               # 工程解析器 (ProjectResolver) 与上下文加载器 (ContextLoader)
│   ├── router/                # 执行器路由器 (ExecutorRouter) 与健康度管理器 (HealthManager)
│   ├── scheduler/             # 全局调度器 (WorkflowScheduler) 与执行器并发槽位管理
│   ├── security/              # 路径守卫、命令守卫与敏感脱敏模块
│   ├── skills/                # 角色标准技能与规范提示模板 (Planning, Review, Fix, Test)
│   ├── task/                  # Task Schema、状态机、持久化存储 (TaskStore) 与 ArtifactStore
│   ├── tools/                 # 进程执行工具 (ProcessTool) 与真实验证工具 (VerificationTools)
│   └── workspace/             # 项目互斥排他锁 (ProjectLockManager) 与工作区管理器
└── tests/                     # 20 个测试套件，共 125 项单元与 E2E 集成测试用例
```

---

## 🚀 快速启动与使用

### 1. 安装依赖与编译
```bash
npm install
npm run build
```

### 2. 运行完整测试套件
```bash
npm test
```

### 3. 类型检查
```bash
npm run type-check
```

### 4. 命令行执行任务
```bash
# 执行 demo 项目任务
npm run run-task -- --project demo --title "实现安全用户删除功能"

# 执行 ComfyUI 绘图工程任务
npm run run-task -- --project comfyui --title "排查工作流节点加载异常"
```

### 5. 启动 Mastra 服务并访问 Web 控制台
```bash
npx mastra dev
```
打开浏览器访问：`http://localhost:4111/` 或 `http://localhost:4111/dashboard`，即可使用图形化控制台提交任务、查看实时时间线审计与制品详情。

---

## 📡 REST API 端点说明

| 方法 | 端点 | 功能描述 |
|---|---|---|
| `GET` | `/` 或 `/dashboard` | 中文可视化控制台页面 |
| `GET` | `/tasks` | 获取任务列表（支持状态与项目筛选） |
| `POST` | `/tasks` | 提交新任务并可自动异步启动工作流 |
| `GET` | `/tasks/:id` | 获取任务详细数据（含 runId、steps、workspace、scheduling） |
| `GET` | `/tasks/:id/timeline` | 获取任务审计时间线 |
| `POST` | `/tasks/:id/cancel` | 取消任务、终止 Run 并安全释放项目排他锁 |
| `POST` | `/tasks/:id/resume` | 恢复挂起或待审批任务 |

---

## 🛡️ 安全规范与免责机制

- 严禁任何 Agent 直接覆写 `task.status = 'DONE'`，必须经由 `CompletionGate` 门禁裁决。
- 严禁 Reviewer 角色直接修改业务代码，仅允许拥有只读、Diff、Test 权限。
- 严禁跳出项目根目录或执行破坏性系统命令（`rm -rf /`、`format`、`DROP TABLE`、`git push -f` 等）。
