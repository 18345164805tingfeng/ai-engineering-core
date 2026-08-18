# AI Engineering Core
## Workflow Decomposition & Safe Concurrency 修改计划

> 阶段定位：V1 Workflow Runtime Enhancement  
> 本轮性质：现有 V1 架构的增量调整，不推翻 Task Gateway、Executor Router、Provider、Task Store 等既有边界。

---

# 1. 本轮目标

当前需要解决两个核心问题：

### 问题一：Workflow 只有一个大节点

当前实际效果类似：

```text
Task
 ↓
software-development
 ↓
内部完成 Analyze / Plan / Develop / Verify / Review / Fix
 ↓
Done
```

导致：

- 无法直观看到当前执行阶段；
- 某一步失败时无法精确标识失败节点；
- Sandbox / Environment 问题难以准确 Suspend；
- Developer、Tester、Reviewer 的状态混在一起；
- Timeline 与 Workflow 状态边界模糊；
- 后续任务管理 UI 无法展示真实执行进度。

需要调整为真正的 Mastra 多 Step Workflow。

---

### 问题二：同一 Workflow 需要同时运行多个 Task

Workflow 应作为：

```text
Workflow Definition
```

每一个 Task 对应独立：

```text
Workflow Run
```

目标：

```text
software-development
        │
        ├── TASK-001 → RUN-001
        ├── TASK-002 → RUN-002
        └── TASK-003 → RUN-003
```

不同 Run：

- 状态独立；
- Timeline 独立；
- Suspend / Resume 独立；
- Cancel 独立；
- Review Round 独立；
- Step Result 独立。

---

# 2. 本轮明确不做

本轮禁止扩展为复杂分布式调度系统。

暂不实现：

```text
自动 PR
自动 Merge
复杂 Merge Conflict Agent
跨机器调度
分布式 Queue
Redis Cluster
复杂优先级抢占
动态扩缩容
多租户资源调度
完整 Git Worktree 并发
```

Git Worktree 作为下一阶段能力预留接口。

---

# 3. 最终 Workflow 结构

将现有单节点 Workflow 拆分为：

```text
Task
 │
 ▼
load-context
 │
 ▼
analyze-task
 │
 ├── needsPlan = false ───────────┐
 │                                │
 ▼                                │
plan-task                         │
 │                                │
 └────────────────┬───────────────┘
                  ▼
          acquire-workspace
                  │
                  ▼
               develop
                  │
                  ▼
               verify
          ┌───────┼───────────────┐
          │       │               │
       PASSED FAILED_CODE      ENV/BLOCKED
          │       │               │
          │       ▼               ▼
          │      fix      VERIFICATION_BLOCKED
          │       │
          │       └────────→ verify
          │
          ▼
        review
       ┌────┴────┐
       │         │
     PASS       FAIL
       │         │
       │         ▼
       │        fix
       │         │
       │         └────────→ verify
       │
       ▼
    finalize
       │
       ▼
      DONE
```

超过 Review 最大轮次：

```text
review
  ↓ FAIL
reviewRound >= maxRounds
  ↓
arbitrate
  │
  ├── CONTINUE_FIX → fix
  ├── ACCEPT       → finalize
  ├── REPLAN       → plan
  ├── BLOCK        → BLOCKED
  └── NEED_HUMAN   → SUSPEND
```

---

# 4. Workflow 主节点

本轮实现以下节点：

```text
load-context
analyze-task
plan-task
acquire-workspace
develop
verify
review
fix
arbitrate
finalize
release-workspace
```

其中：

- `plan-task` 可跳过；
- `arbitrate` 条件触发；
- `release-workspace` 属于资源清理步骤；
- 暂不把 Verify / Quality Loop 做成 Subworkflow。

---

# 5. Step State

新增统一 Step 状态：

```text
PENDING
RUNNING
COMPLETED
FAILED
BLOCKED
SKIPPED
CANCELLED
```

统一 Step Result：

```json
{
  "step": "develop",
  "status": "COMPLETED",
  "startedAt": "...",
  "endedAt": "...",
  "durationMs": 12000,
  "executor": {
    "id": "codex",
    "type": "agent"
  },
  "model": null,
  "summary": "...",
  "artifactIds": [],
  "error": null
}
```

禁止不同 Step 自行定义完全不兼容的执行状态结构。

---

# 6. Task Schema 增量调整

不要重新设计现有 Task Schema。

在现有结构上增加：

```json
{
  "workflow": {
    "workflowId": "software-development",
    "runId": null,
    "currentStep": null
  },

  "steps": [],

  "workspace": {
    "id": null,
    "mode": "shared-lock",
    "root": null,
    "branch": null,
    "baseBranch": null
  },

  "scheduling": {
    "status": "READY",
    "queuedAt": null,
    "startedAt": null,
    "waitingReason": null
  }
}
```

保留既有：

```text
analysis
plan
execution
verification
review
arbitration
timeline
```

避免破坏现有 API 和消费者。

---

# 7. Workflow Definition 与 Workflow Run 分离

明确：

```text
Workflow Definition
       ≠
Workflow Run
```

Task 启动时：

```text
TaskGateway
    ↓
创建 Internal Task
    ↓
softwareDevelopmentWorkflow.createRun()
    ↓
获取 runId
    ↓
保存 taskId ↔ runId
    ↓
启动 Workflow Run
```

必须保证：

```text
TASK-001 → RUN-001
TASK-002 → RUN-002
```

互不共享：

```text
Step State
Review Round
Verification Result
Suspend State
Timeline
Artifacts
```

---

# 8. 状态权责重新明确

## Agent

Agent 只能决定：

```text
当前阶段是否执行完成
```

例如：

```text
Developer COMPLETED
```

只代表开发 Agent 执行结束。

禁止代表：

```text
Task DONE
```

---

## Verification Engine

拥有：

```text
代码验证结果裁决权
```

---

## Reviewer

拥有：

```text
Review PASS / FAIL 裁决权
```

但默认没有业务代码修改权。

---

## Mastra Workflow

拥有：

```text
Task 状态流转权
```

---

## Finalize

只有：

```text
finalize
```

可以设置：

```text
DONE
DONE_WITH_WARNINGS
```

---

# 9. Verification Result

不再只使用：

```text
PASS
FAIL
```

改为：

```text
PASSED
FAILED_CODE
FAILED_ENVIRONMENT
BLOCKED_SANDBOX
BLOCKED_PERMISSION
TIMEOUT
CANCELLED
INDETERMINATE
```

Workflow 分流：

```text
PASSED
 → Review

FAILED_CODE
 → Fix

FAILED_ENVIRONMENT
BLOCKED_SANDBOX
BLOCKED_PERMISSION
INDETERMINATE
 → VERIFICATION_BLOCKED

TIMEOUT
 → Retry / BLOCKED
```

明确：

> 无法验证 ≠ 验证成功。

---

# 10. Verification 必须独立于 Developer

禁止：

```text
Developer
 ↓
自己运行测试
 ↓
自己解释测试
 ↓
自己宣布成功
```

正式验证必须：

```text
Develop
 ↓
Verification Step
 ↓
真实 ToolProvider
 ↓
Process Result
 ↓
Verification Classifier
```

Agent 自报测试结果只能作为辅助信息。

证据优先级：

```text
真实 Tool Result
      >
结构化 Executor Result
      >
Agent 自然语言描述
```

---

# 11. Completion Gate

新增统一：

```text
CompletionGate
```

例如：

```text
developmentCompleted = true
verification.status = PASSED
review.status = PASSED
blockingIssues = 0
```

才能：

```text
DONE
```

如果测试因环境问题无法执行，且经过人工明确豁免：

```text
DONE_WITH_WARNINGS
```

禁止任何 Agent 直接设置最终 Task 状态。

---

# 12. 多任务并发模型

V1 采用：

> **Workflow 多 Run + Project Safe Lock**

允许：

```text
不同 Project
→ 并发开发
```

暂时禁止：

```text
同一 Project
→ 同时修改同一个工作目录
```

---

# 13. Project Lock

新增：

```text
ProjectLockManager
```

例如：

```text
project-a
  TASK-001 → LOCK_OWNER

project-a
  TASK-002 → WAITING_FOR_WORKSPACE

project-b
  TASK-003 → LOCK_OWNER
```

TASK-001 和 TASK-003：

```text
可以并发
```

TASK-002：

```text
等待 TASK-001
```

---

# 14. Lock 生命周期

不要只锁 `develop`。

否则：

```text
TASK-001 Develop 完成
 ↓
释放 Lock

TASK-002 开始修改代码
 ↓
TASK-001 Verify / Review
```

会发生代码污染。

因此 shared workspace 模式下，Lock 必须覆盖整个：

```text
Develop
 ↓
Verify
 ↓
Review
 ↓
Fix Loop
 ↓
Finalize
```

生命周期：

```text
acquire-workspace
      ↓
develop
      ↓
quality loop
      ↓
finalize
      ↓
release-workspace
```

异常：

```text
FAILED
CANCELLED
DONE
DONE_WITH_WARNINGS
```

必须释放 Lock。

对于长期 BLOCKED 状态，本轮优先保证安全：

```text
默认继续持有 Workspace Lock
```

避免其他 Task 修改工作区导致 Resume 后上下文失效。

后续 Worktree 模式再解决长期占锁问题。

---

# 15. Workspace 抽象

现在就建立：

```text
WorkspaceManager
```

但 V1 只实现：

```text
SharedProjectWorkspace
```

接口：

```text
acquire(task)
release(task)
getWorkspace(task)
healthCheck(task)
```

V1 返回：

```text
workspace.root = project.root
workspace.mode = shared-lock
```

以后增加：

```text
GitWorktreeWorkspace
```

时 Workflow 不需要修改。

---

# 16. Path Guard 边界调整

安全边界从概念上的：

```text
projectRoot
```

升级为：

```text
workspaceRoot
```

V1：

```text
workspaceRoot === projectRoot
```

未来 Worktree：

```text
workspaceRoot =
D:/ai-workspaces/project/TASK-001
```

所有文件操作、Shell cwd、Git 操作优先使用：

```text
workspace.root
```

而不是直接使用：

```text
project.root
```

---

# 17. Executor 并发控制

增加轻量：

```text
ExecutorConcurrencyManager
```

通过配置控制：

```yaml
executors:
  codex:
    maxConcurrency: 2

  antigravity:
    maxConcurrency: 2

  qwen-local:
    maxConcurrency: 1
```

目标：

避免：

```text
本地单 GPU Qwen
```

被多个任务同时调用。

不要在 Provider 内自行实现任务队列。

---

# 18. Global Workflow Concurrency

配置：

```yaml
workflow:
  maxConcurrentRuns: 4
```

超过时：

```text
Task → QUEUED
```

有 Slot 后：

```text
QUEUED → RUNNING
```

V1 只实现简单 FIFO 即可。

不要实现复杂优先级调度。

---

# 19. Task Scheduling 状态

建议增加：

```text
READY
QUEUED
RUNNING
WAITING_FOR_WORKSPACE
WAITING_FOR_EXECUTOR
```

注意：

Scheduling Status 不等于 Task Business Status。

例如：

```text
Task.status = CODING
Scheduling.status = WAITING_FOR_EXECUTOR
```

不要把资源等待状态全部塞入业务状态机。

---

# 20. Timeline

每个 Step 至少记录：

```text
step.started
step.completed
step.failed
step.blocked
step.skipped
```

并增加：

```text
workflow.run.created
workflow.run.started
workflow.run.completed

workspace.waiting
workspace.acquired
workspace.released

executor.waiting
executor.acquired
executor.released
```

Timeline 只保存摘要。

完整结果继续保存 Artifact。

---

# 21. Task API 增量返回

`GET /tasks/:id` 增加：

```json
{
  "workflow": {
    "runId": "RUN-001",
    "currentStep": "verify"
  },

  "workspace": {
    "mode": "shared-lock",
    "status": "ACQUIRED"
  },

  "scheduling": {
    "status": "RUNNING"
  },

  "steps": [
    {
      "id": "develop",
      "status": "COMPLETED",
      "executor": "codex",
      "durationMs": 42000
    },
    {
      "id": "verify",
      "status": "RUNNING"
    }
  ]
}
```

---

# 22. Cancel

Cancel 必须针对：

```text
具体 Workflow Run
```

而不是 Workflow Definition。

流程：

```text
Task ID
 ↓
找到 runId
 ↓
取消当前 Step / Executor
 ↓
停止后续 Step
 ↓
释放 Workspace / Executor Slot
 ↓
CANCELLED
```

必须保证资源释放发生在 finally / cleanup 路径。

---

# 23. Resume

Resume 同样针对：

```text
具体 runId
```

恢复：

```text
WAITING_FOR_CONTEXT
WAITING_FOR_APPROVAL
VERIFICATION_BLOCKED
```

等可恢复状态。

---

# 24. 未来 Git Worktree 预留

本轮不要求实现。

但 WorkspaceManager 必须允许未来增加：

```text
workspace.mode = git-worktree
```

未来：

```text
TASK-001
 ↓
branch ai/TASK-001
 ↓
worktree/TASK-001

TASK-002
 ↓
branch ai/TASK-002
 ↓
worktree/TASK-002
```

届时才能安全实现：

```text
同一 Project 多 Task 并发 Coding
```

未来还需要新增：

```text
merge
merge-conflict
post-merge-verify
```

本轮禁止提前实现。

---

# 25. 推荐目录

在不破坏当前项目结构的前提下，建议演进为：

```text
src/

├── mastra/
│   └── workflows/
│       └── software-development/
│           ├── index.ts
│           │
│           ├── steps/
│           │   ├── load-context.ts
│           │   ├── analyze-task.ts
│           │   ├── plan-task.ts
│           │   ├── acquire-workspace.ts
│           │   ├── develop.ts
│           │   ├── verify.ts
│           │   ├── review.ts
│           │   ├── fix.ts
│           │   ├── arbitrate.ts
│           │   ├── finalize.ts
│           │   └── release-workspace.ts
│           │
│           ├── schemas/
│           │   ├── step-result.ts
│           │   ├── workflow-state.ts
│           │   └── verification-result.ts
│           │
│           └── helpers/
│               ├── completion-gate.ts
│               └── workflow-events.ts
│
├── workspace/
│   ├── workspace-manager.ts
│   ├── shared-project-workspace.ts
│   └── project-lock-manager.ts
│
└── scheduling/
    ├── workflow-concurrency.ts
    └── executor-concurrency.ts
```

目录以当前真实项目结构为准。

禁止为了匹配本文而强制移动大量已有代码。

---

# 26. 实施 Phase

## Phase A：现状基线

先分析当前实现：

```text
Workflow
Task Schema
Task Store
Timeline
Verification
Review Loop
Cancel / Resume
Executor Router
```

输出当前调用图。

不得修改代码。

---

## Phase B：Run / Step Schema

实现：

```text
workflow.runId
currentStep
steps[]
StepResult
StepStatus
```

保持现有 Schema 向后兼容。

---

## Phase C：Workflow Decomposition

逐步拆出：

```text
load-context
analyze
plan
develop
verify
review
fix
arbitrate
finalize
```

确保每拆一个节点项目仍然可运行。

---

## Phase D：Verification & Completion Gate

解决：

```text
Agent success ≠ Verification success
```

实现：

```text
VerificationResult
Verification Classifier
CompletionGate
```

---

## Phase E：Multi-Run

实现：

```text
Task → Mastra Run
taskId ↔ runId
```

验证两个 Task 可以同时存在独立 Run。

---

## Phase F：Safe Concurrency

实现：

```text
Global Run Limit
ProjectLockManager
ExecutorConcurrencyManager
WorkspaceManager(shared-lock)
```

---

## Phase G：Timeline / API / Cancel / Resume

暴露：

```text
currentStep
steps
runId
workspace status
scheduling status
```

完善资源清理。

---

## Phase H：E2E

完成完整验收。

---

# 27. 必须覆盖的 E2E

### Case 1：单任务一次通过

```text
Develop
→ Verify PASS
→ Review PASS
→ DONE
```

### Case 2：Review Fix Loop

```text
Review FAIL
→ Fix
→ Verify
→ Review PASS
```

### Case 3：代码验证失败

```text
Verify FAILED_CODE
→ Fix
```

### Case 4：Sandbox 阻塞

```text
Verify BLOCKED_SANDBOX
→ VERIFICATION_BLOCKED
```

禁止进入 DONE。

### Case 5：两个不同项目并发

```text
Project A / TASK-001
Project B / TASK-002
```

两者同时运行。

### Case 6：同一个项目两个 Task

```text
TASK-001
→ ACQUIRED WORKSPACE

TASK-002
→ WAITING_FOR_WORKSPACE
```

TASK-001 完成释放后：

```text
TASK-002
→ ACQUIRED
```

### Case 7：Executor 限流

例如：

```text
qwen-local maxConcurrency = 1
```

两个请求必须串行。

### Case 8：Cancel

取消一个 Run：

```text
RUN-001 → CANCELLED
```

不能影响：

```text
RUN-002
```

### Case 9：Review 超过最大轮次

进入：

```text
arbitrate
```

### Case 10：Agent 自报成功但真实测试失败

最终必须：

```text
NOT DONE
```

---

# 28. Definition of Done

本轮完成必须满足：

- [ ] Mastra 能看到多个真实 Workflow Step
- [ ] 每个 Task 对应独立 Workflow Run
- [ ] 同一 Workflow 可以同时存在多个 Run
- [ ] Task 保存 `runId`
- [ ] API 能返回 `currentStep`
- [ ] 每个 Step 有独立状态
- [ ] Developer success 不代表 Task success
- [ ] Verification 由真实工具裁决
- [ ] Sandbox / 环境异常不会产生假成功
- [ ] Review Fix Loop 正常运行
- [ ] Completion Gate 生效
- [ ] 不同项目可并发
- [ ] 同一项目 Shared Workspace 默认串行
- [ ] Executor 支持配置并发限制
- [ ] Cancel 只取消对应 Run
- [ ] Suspend / Resume 只影响对应 Run
- [ ] Workspace Lock 能正确释放
- [ ] Timeline 可还原完整执行过程
- [ ] Workflow 不绑定具体 Model / Provider
- [ ] 原有 Task Gateway / Executor / Provider 边界不被破坏

---

# 29. 本轮最重要的四条规则

> **Workflow 是定义，Run 才是一次任务实例。**

> **Agent 执行成功，不代表 Task 成功。**

> **无法验证，不等于验证通过。**

> **没有独立 Workspace 时，同一项目禁止并发修改。**