# AI Engineering Core — Workflow Decomposition & Safe Concurrency

你正在继续开发现有 **AI Engineering Core** 项目。

本轮不是重新设计项目，也不是重写现有系统，而是在现有 PRD 和现有代码基础上进行：

> **Workflow Decomposition & Safe Concurrency**

请首先完整阅读：

```text
AGENTS.md
AI-Engineering-Core-V1-PRD-实施计划.md
package.json
src/mastra
Task Gateway
Task Schema / Task Store
Executor Router
Codex Provider
Antigravity Provider
ToolProvider
Verification
Timeline
REST API
```

并以当前实际实现作为修改基线。

---

# 一、本轮核心目标

完成两件事情：

## 1. 将当前单节点 Workflow 拆成真实 Mastra Workflow Steps

目标：

```text
load-context
 ↓
analyze-task
 ↓
plan-task
 ↓
acquire-workspace
 ↓
develop
 ↓
verify
 ↓
review
 ↓
fix loop
 ↓
arbitrate（必要时）
 ↓
finalize
 ↓
release-workspace
```

Mastra Studio / Trace 中必须能够看到这些真实业务阶段。

---

## 2. 支持同一个 Workflow 同时启动多个独立 Task

要求：

```text
Workflow Definition
        │
        ├── TASK-001 → RUN-001
        ├── TASK-002 → RUN-002
        └── TASK-003 → RUN-003
```

每一个 Task：

```text
runId
step state
timeline
review round
verification
suspend/resume
cancel
```

必须相互独立。

---

# 二、现有架构边界禁止破坏

继续坚持：

```text
Task Source
 ↓
Task Gateway
 ↓
Internal Task
 ↓
Project Resolver / Context
 ↓
Mastra Workflow
 ↓
Role
 ↓
Executor Router
 ↓
AgentProvider / ModelProvider
 ↓
ToolProvider
```

禁止：

```text
Workflow 直接写死 Codex

Workflow 直接写死 Gemini

Workflow 直接写死 Qwen

Provider 操作 Task 状态机

Reviewer 直接修改业务代码

外部任务来源侵入 Workflow
```

---

# 三、特别重要的状态权责

必须实现以下边界：

```text
Developer Agent
→ 只有开发阶段执行权

Verification Engine
→ 验证裁决权

Reviewer
→ Review 裁决权

Mastra Workflow
→ 状态流转权

Finalize / CompletionGate
→ Task 最终完成权
```

任何 Agent 都禁止直接：

```text
task.status = DONE
```

---

# 四、Agent Success 不等于 Task Success

例如：

```text
Codex:
开发完成，测试因为 Sandbox 无法运行。
```

即使 Codex 返回：

```text
success
```

Workflow 也只能认为：

```text
develop = COMPLETED
```

随后必须进入独立：

```text
verify
```

真实工具无法完成验证：

```text
BLOCKED_SANDBOX
```

Task 不得进入 DONE。

---

# 五、Verification Result

至少支持：

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

分流：

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
```

不要将所有 Test Failure 都交给 Developer 修改代码。

---

# 六、真实 Tool Result 是最高证据

统一遵循：

```text
Real Tool Result
      >
Structured Executor Result
      >
Agent Natural Language
```

正式 Verification Command 必须由系统运行。

不要依赖 Developer 自己运行：

```text
pnpm test || true
```

然后根据 Agent 的文字结论判断成功。

---

# 七、Completion Gate

实现统一：

```text
CompletionGate
```

正常 DONE 至少要求：

```text
development completed
verification passed
review passed
no blocking issue
```

人工明确豁免 Verification 才可以：

```text
DONE_WITH_WARNINGS
```

---

# 八、Workflow Step

统一 Step Status：

```text
PENDING
RUNNING
COMPLETED
FAILED
BLOCKED
SKIPPED
CANCELLED
```

统一 Step Result。

必须包含：

```text
step id
status
startedAt
endedAt
duration
executor
model（如果可获得）
summary
artifactIds
error
```

不要让每个 Step 自己设计互不兼容的状态结构。

---

# 九、Task Schema 只做增量修改

不要重写现有 Task Schema。

在现有结构基础上增加：

```text
workflow.runId
workflow.currentStep
steps
workspace
scheduling
```

建议：

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

保持：

```text
analysis
plan
execution
verification
review
arbitration
timeline
```

现有消费者尽可能兼容。

---

# 十、Workflow Run

Task 启动时：

```text
TaskGateway
 ↓
Internal Task
 ↓
create Workflow Run
 ↓
获得 runId
 ↓
保存 taskId ↔ runId
 ↓
start
```

禁止多个 Task 共用同一个 mutable Workflow Run State。

---

# 十一、安全并发策略

本轮不是实现完整多项目调度系统。

只实现：

> **Multiple Runs + Safe Project Lock**

规则：

```text
不同 Project
→ 可以并发

同一个 Project
→ Shared Workspace 模式下只能有一个 Task 进入代码执行区
```

---

# 十二、Project Lock Manager

增加统一：

```text
ProjectLockManager
```

例如：

```text
Project A
TASK-001 → LOCK OWNER
TASK-002 → WAITING_FOR_WORKSPACE

Project B
TASK-003 → LOCK OWNER
```

TASK-001 与 TASK-003 可以并行。

---

# 十三、Lock Scope

Project Lock 不得只覆盖 Develop。

必须覆盖：

```text
acquire workspace
 ↓
develop
 ↓
verify
 ↓
review
 ↓
fix
 ↓
verify
 ↓
review
 ↓
finalize
 ↓
release workspace
```

原因：

另一个 Task 如果在 Verify / Review 时修改工作区，会污染当前 Task 的：

```text
Git Diff
Tests
Review
Artifacts
```

---

# 十四、WorkspaceManager

增加：

```text
WorkspaceManager
```

V1 只需要支持：

```text
shared-lock
```

接口概念：

```text
acquire
release
getWorkspace
```

V1：

```text
workspace.root = project.root
```

未来预留：

```text
git-worktree
```

本轮禁止实现完整 Git Worktree 流程。

---

# 十五、执行安全边界

文件和 Shell 操作以后优先基于：

```text
workspace.root
```

而不是直接基于：

```text
project.root
```

V1 两者相同。

这样未来切换 Git Worktree 时不需要重写 ToolProvider。

---

# 十六、Executor Concurrency

增加轻量并发限制。

配置示例：

```yaml
executors:
  codex:
    maxConcurrency: 2

  antigravity:
    maxConcurrency: 2

  qwen-local:
    maxConcurrency: 1
```

特别注意：

本地单 GPU 模型不能默认无限并发。

Provider 不负责队列。

统一由调度层处理。

---

# 十七、Global Workflow Concurrency

增加：

```yaml
workflow:
  maxConcurrentRuns: 4
```

超过：

```text
QUEUED
```

有资源：

```text
RUNNING
```

本轮 FIFO 即可。

禁止实现复杂优先级或抢占。

---

# 十八、Scheduling 与 Business Status 分离

Scheduling Status 建议：

```text
READY
QUEUED
RUNNING
WAITING_FOR_WORKSPACE
WAITING_FOR_EXECUTOR
```

它不等于 Task Business Status。

不要为了资源等待疯狂扩展 Task 主状态机。

---

# 十九、Review Loop

保持现有规则：

```text
Verify
 ↓
Review
 │
 ├── PASS → Finalize
 │
 └── FAIL → Fix
              ↓
            Verify
              ↓
            Review
```

Review 达到：

```text
maxRounds
```

后进入：

```text
arbitrate
```

Fix 后禁止直接 Review。

必须重新 Verify。

---

# 二十、Architect

Architect 只在必要时运行。

输出至少：

```text
CONTINUE_FIX
ACCEPT
REPLAN
BLOCK
NEED_HUMAN
```

Workflow 根据结构化结果决定后续。

---

# 二十一、Timeline

每一个 Workflow Step 记录：

```text
step.started
step.completed
step.failed
step.blocked
step.skipped
```

增加：

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

Timeline 保存审计摘要。

完整结果放 Artifact。

不要重复把大 Payload 塞入 Timeline。

---

# 二十二、API

现有：

```text
POST /tasks
GET /tasks/:id
GET /tasks/:id/timeline
POST /tasks/:id/cancel
POST /tasks/:id/resume
```

保持兼容。

`GET /tasks/:id` 增量返回：

```text
runId
currentStep
steps
workspace
scheduling
```

---

# 二十三、Cancel

Cancel 必须只针对当前 Task 对应的 Run。

例如：

```text
TASK-001 → RUN-001
TASK-002 → RUN-002
```

取消 TASK-001：

```text
RUN-001 CANCELLED
```

不能影响 RUN-002。

Cancel 必须尽量传播到：

```text
Codex CLI
Antigravity
ProcessTool
Local Model
```

同时确保：

```text
Workspace Lock
Executor Slot
```

最终释放。

资源释放应位于可靠 cleanup / finally 路径。

---

# 二十四、Resume

Resume 必须使用对应：

```text
runId
```

恢复当前 Run。

不得重新创建一个完全无关的新 Workflow Run 来冒充 Resume。

---

# 二十五、暂不实现 Git Worktree

只预留：

```text
WorkspaceManager
workspace.mode
workspace.id
workspace.root
branch
baseBranch
```

未来：

```text
shared-lock
→ git-worktree
```

以后才能实现同一 Project 多 Task 真并行。

本轮不要提前开发：

```text
automatic branch
automatic merge
merge conflict agent
automatic PR
```

---

# 二十六、实施顺序

严格按照以下 Phase 实施。

## Phase A — Baseline

只分析，不修改。

输出：

```text
当前 Workflow 调用关系
当前 Task Schema
当前状态流转
当前 Review Loop
当前 Verification
当前 Cancel / Resume
当前 Timeline
当前 Executor 调用
```

以及：

```text
本轮预计修改文件
兼容风险
```

---

## Phase B — Run / Step Schema

实现：

```text
runId
currentStep
steps
StepStatus
StepResult
```

完成后执行测试。

---

## Phase C — Workflow Decomposition

逐个拆：

```text
load-context
analyze-task
plan-task
develop
verify
review
fix
arbitrate
finalize
```

不要一次整体推翻。

---

## Phase D — Verification / Completion Gate

实现：

```text
VerificationResult
Verification Classifier
CompletionGate
```

---

## Phase E — Multiple Workflow Runs

实现：

```text
taskId ↔ runId
```

验证两个 Task 可以拥有两个独立 Run。

---

## Phase F — Workspace & Safe Concurrency

实现：

```text
WorkspaceManager
ProjectLockManager
Global Run Limit
Executor Concurrency
```

---

## Phase G — API / Timeline / Cancel / Resume

补充状态暴露和 cleanup。

---

## Phase H — E2E

运行所有验收场景。

---

# 二十七、必须测试的场景

至少实现自动测试或可靠集成测试：

```text
1. 单任务一次成功

2. Review FAIL → Fix → Verify → Review PASS

3. Verify FAILED_CODE → Fix

4. BLOCKED_SANDBOX 不允许 DONE

5. 两个不同项目 Task 同时运行

6. 同项目两个 Task：
   一个运行
   一个 WAITING_FOR_WORKSPACE

7. Executor maxConcurrency 生效

8. Cancel 一个 Run 不影响另外一个 Run

9. Review maxRounds → Arbitrate

10. Agent 返回 success，
    真实 Test 失败，
    Task 不得 DONE

11. Run A Suspend 不影响 Run B

12. Run A Timeline 不得写入 Run B
```

---

# 二十八、禁止事项

本轮禁止：

```text
无关重构

重新设计 Task Gateway

重写 Executor Router

删除已有兼容字段

Workflow 写死具体模型

Reviewer 获得 Write 权限

把 Project Lock 放入 Provider

用 Agent 自然语言驱动 Workflow 分支

用 Agent success 判断 Task DONE

实现完整 Git Worktree

实现 Auto Merge / Auto PR

引入复杂分布式消息队列
```

---

# 二十九、开发原则

继续遵守：

```text
Minimal Change

Backward Compatible

Structured Output

Real Tool Result

Fail Fast

No Fake Success

No Model Binding in Workflow

No Workflow State in Provider
```

---

# 三十、完成后输出报告

每一个 Phase 完成后都必须输出：

```text
1. 当前 Phase 修改摘要

2. 修改文件列表

3. Schema 变化

4. Workflow 变化

5. 兼容性说明

6. 实际执行的测试命令

7. 测试结果

8. 尚未完成的问题

9. 下一 Phase 是否可以开始
```

最终完成时额外输出：

```text
Workflow 图

Task → Run 映射说明

Step 状态说明

Concurrency 策略

Workspace 策略

Verification 判定策略

Completion Gate

Cancel / Resume 行为

E2E 测试结果
```

---

# 三十一、第一步现在只做分析

现在不要立即修改代码。

先执行：

```text
Phase A — Baseline
```

完整检查当前项目，并输出：

```text
一、当前 Workflow 实现

二、当前一个 Task 是如何启动 Workflow 的

三、当前是否已经存在 runId

四、当前 Task State 如何保存

五、当前 Develop / Verify / Review / Fix 在哪里实现

六、当前 Test 是否由真实工具独立执行

七、当前 Agent success 是否可能直接影响 DONE

八、当前 Cancel / Resume 如何实现

九、当前代码是否支持多个 Workflow Run

十、同一项目并发时可能发生哪些数据竞争

十一、预计修改文件

十二、Phase B 最小修改方案
```

**先完成分析，不要直接进入 Phase B。**