# AI Engineering Core V1 Hardening Phase

你正在继续开发一个已经完成主体架构的 **AI Engineering Core** 项目。

当前项目已经完成主要模块和主流程，本轮不是重新设计架构，也不是增加新的大功能，而是进行：

> **V1 Hardening / 安全加固与发布前收尾**

请先完整检查当前项目代码、已有目录结构、现有 AGENTS.md、README、配置文件、Mastra Workflow、TaskGateway、Executor、Tool、Task Store 等实现，再开始修改。

---

# 一、本轮目标

本轮只处理以下 4 类问题：

1. Security Hardening
2. Task REST API
3. Timeline / Artifact 审计增强
4. Skills 基础模板

优先级：

```text
P0
├── ProjectPathGuard
├── ProcessCommandGuard
└── SecretRedactor

P1
├── Mastra Task REST API
├── Timeline Event
└── Artifact Reference

P2
└── Skills Templates
```

除此之外：

> 禁止进行无关重构。

---

# 二、必须遵守的架构原则

当前系统架构已经确定，禁止在本轮修改核心边界。

必须继续保持：

```text
Task Source
    ↓
Task Gateway
    ↓
Internal Task
    ↓
Mastra Workflow
    ↓
Role
    ↓
Executor Router
    ↓
AgentProvider / ModelProvider
    ↓
Codex / Antigravity / Qwen / Tools
```

继续遵守以下原则：

```text
Workflow ≠ Project

Role ≠ Model

Role ≠ Executor

Task 是整个系统的协作中心

Reviewer 默认没有代码修改权

测试结果必须来自真实工具链

Mastra 负责编排，不负责具体模型

外部任务来源不得侵入 Workflow
```

禁止为了完成本轮任务破坏这些原则。

---

# 三、禁止事项

本轮明确禁止：

```text
1. 禁止重构现有整体架构

2. 禁止改变 AgentProvider / ModelProvider / Executor 边界

3. 禁止将 Codex、Antigravity、Qwen 直接写死到 Workflow

4. 禁止增加第二套独立 HTTP Server

5. 禁止重新设计 Task Schema

6. 禁止让 Reviewer 获得业务代码修改权限

7. 禁止修改与本任务无关的业务逻辑

8. 禁止为了“代码更漂亮”进行大面积重命名或目录调整

9. 禁止在未检查全部消费端前修改公开接口

10. 禁止仅依靠 Prompt 实现安全限制
```

安全限制必须由真实代码控制。

---

# 四、P0：ProjectPathGuard

当前要求：

> 所有文件操作不得越出当前 `projectRoot`。

不要简单实现：

```js
path.resolve(targetPath).startsWith(projectRoot)
```

因为存在路径前缀误判问题，例如：

```text
projectRoot:
D:/projects/demo

target:
D:/projects/demo-backup/file.txt
```

请实现统一：

```text
ProjectPathGuard
```

建议职责：

```text
src/security/project-path-guard.*
```

或根据当前项目实际目录结构选择最合适的位置。

核心逻辑必须基于：

```js
const root = path.resolve(projectRoot)
const target = path.resolve(projectRoot, inputPath)

const relative = path.relative(root, target)

if (
  relative.startsWith('..') ||
  path.isAbsolute(relative)
) {
  throw ...
}
```

同时检查 symlink 越界风险。

需要考虑：

```text
project/
  link -> C:/outside
```

如果运行环境允许 symlink，应使用 `realpath` 或等价机制验证最终真实路径仍然位于 `projectRoot`。

---

## ProjectPathGuard 必须覆盖

检查现有所有文件相关 Tool / Executor。

至少包括：

```text
read
write
create
delete
mkdir
copy
move
rename
```

凡是接受文件路径的位置，都不能绕过该 Guard。

不要在每个 Tool 中重复实现路径判断。

必须集中复用。

---

## ProjectPathGuard 测试

至少增加：

```text
✓ 正常相对路径

✓ projectRoot 内部嵌套目录

✓ ../ 越界

✓ 多层 ../../ 越界

✓ 绝对路径越界

✓ projectRoot 相似前缀目录

✓ Windows 路径

✓ Unix 路径（如果当前项目需要跨平台）

✓ symlink 越界（环境支持时）
```

---

# 五、P0：ProcessCommandGuard

当前 `ProcessTool` 或对应 Shell Tool 不允许继续直接无约束执行任意命令。

不要只做简单字符串 denylist。

建立统一：

```text
ProcessCommandGuard
```

建议模型：

```text
SAFE
APPROVAL_REQUIRED
DENIED
```

执行流程：

```text
Command
   ↓
ProcessCommandGuard
   ↓
SAFE
   ↓
执行

APPROVAL_REQUIRED
   ↓
暂停 / 请求确认

DENIED
   ↓
拒绝执行
```

---

## 默认安全命令

例如以下通常可视为 SAFE：

```text
git status
git diff
git log

npm test
npm run test
npm run build
npm run lint

pnpm test
pnpm build
pnpm lint

yarn test

pytest
mvn test
gradle test
```

但不要将这些命令完全写死成唯一允许范围。

---

## 高风险命令

至少考虑：

```text
rm -rf

rmdir /s

del /s

format

diskpart

shutdown

reboot

mkfs

dd

git clean -fdx

git reset --hard

DROP DATABASE

DROP TABLE

TRUNCATE
```

以及其他明显具有：

```text
删除系统数据
删除项目大量文件
覆盖磁盘
破坏 Git 工作区
影响系统运行
```

风险的命令。

---

## 配置能力

支持项目或全局配置：

```yaml
commands:
  allow: []
  deny: []
  approvalRequired: []
```

如果项目当前已有配置系统，请复用。

不要重复造配置机制。

---

## Approval

如果当前 Workflow 已支持 suspend / resume：

```text
APPROVAL_REQUIRED
```

应尽量复用该机制。

如果当前版本尚未具备完整人工审批能力：

允许先返回：

```text
WAITING_FOR_APPROVAL
```

或现有等价状态。

不要偷偷执行风险命令。

---

# 六、P0：SecretRedactor

增加统一：

```text
SecretRedactor
```

不要让：

```text
Logger
Timeline
TaskGateway
CodexProvider
AntigravityProvider
ProcessTool
```

分别自行实现脱敏。

所有进入：

```text
日志
Timeline
Artifact metadata
错误日志
Executor 输出记录
```

的数据，在持久化或打印前，应经过统一脱敏层。

---

## 至少识别

```text
API_KEY

APIKEY

TOKEN

ACCESS_TOKEN

REFRESH_TOKEN

PASSWORD

PASSWD

SECRET

CLIENT_SECRET

Authorization

Bearer
```

例如：

```text
Authorization: Bearer abcdef123456
```

输出：

```text
Authorization: Bearer [REDACTED]
```

例如：

```text
OPENAI_API_KEY=sk-xxxx
```

输出：

```text
OPENAI_API_KEY=[REDACTED]
```

---

## 已知环境变量

如果可以安全实现：

优先识别当前进程中的已知 Secret 环境变量值，并对日志中的对应值做替换。

注意：

不要把全部 `process.env` 当成 Secret。

只处理明显敏感字段。

---

# 七、P1：Task REST API

PRD 中要求：

```text
POST /tasks

GET /tasks/:id

GET /tasks/:id/timeline

POST /tasks/:id/cancel

POST /tasks/:id/resume
```

当前已有：

```text
TaskGateway
scripts/run-task.ts
```

但尚未正式暴露 HTTP API。

---

# 八、不要创建新的独立 HTTP Server

这是本轮非常重要的约束。

项目本身已经基于 Mastra。

优先使用：

```text
Mastra Server
+
Mastra Custom API Routes
```

最终结构应类似：

```text
Mastra Server

├── Mastra Agent / Workflow routes

└── Task Routes
    ├── POST /tasks
    ├── GET /tasks/:id
    ├── GET /tasks/:id/timeline
    ├── POST /tasks/:id/cancel
    └── POST /tasks/:id/resume
```

不要再启动：

```text
Express Server

Fastify Server

另一个 standalone server
```

除非当前 Mastra 版本确实无法实现，并且你能够给出充分证据。

---

# 九、POST /tasks

输入示例：

```json
{
  "project": {
    "root": "/workspace/demo"
  },
  "requirement": "增加用户删除功能",
  "mode": "auto"
}
```

如果当前 Task Schema 已经不同：

> 以当前已有 Task Schema 为准。

不要为了匹配这个示例重新设计 Schema。

处理：

```text
HTTP Request
    ↓
TaskGateway
    ↓
Internal Task
    ↓
启动 Mastra Development Workflow
```

返回至少：

```json
{
  "taskId": "TASK-xxx",
  "status": "CREATED"
}
```

或当前系统实际状态。

---

# 十、GET /tasks/:id

返回当前 Task。

至少包含：

```text
id

status

project

requirement

workflow mode

当前 phase

review round

timestamps
```

敏感字段必须先脱敏。

---

# 十一、GET /tasks/:id/timeline

返回：

```text
Timeline Event[]
```

不要返回无法控制的大量原始模型输出。

---

# 十二、POST /tasks/:id/cancel

需要做到真实取消。

不要只是：

```text
task.status = CANCELLED
```

请检查当前 Executor / Workflow。

如果当前运行中的 Executor 支持：

```text
cancel
abort
AbortController
process kill
```

则取消必须传播到真正正在运行的执行器。

如果某些 Provider 暂时无法取消：

明确记录：

```text
cancel_requested
```

并防止后续 Workflow 继续进入新的执行步骤。

---

# 十三、POST /tasks/:id/resume

用于恢复：

```text
WAITING_FOR_CONTEXT

WAITING_FOR_APPROVAL

SUSPENDED
```

等状态。

优先复用 Mastra Workflow 的 suspend/resume 能力。

输入可允许：

```json
{
  "data": {}
}
```

供补充上下文、审批信息等。

---

# 十四、P1：Timeline 重构为审计摘要

当前 Timeline 需要增强。

但是：

> 禁止把所有完整 Payload 都塞进 Timeline。

不要将：

```text
完整 git diff

完整测试日志

完整模型输出

完整 Shell stdout

完整 Review Prompt
```

全部写进 Timeline。

---

# 十五、Timeline Event

Timeline 只保存：

```text
关键事件

关键状态

数量

耗时

结论

Artifact 引用
```

例如测试：

```json
{
  "type": "test.completed",
  "timestamp": "...",
  "data": {
    "status": "passed",
    "total": 128,
    "passed": 128,
    "failed": 0,
    "durationMs": 5821,
    "artifactId": "ARTIFACT-001"
  }
}
```

Review：

```json
{
  "type": "review.completed",
  "timestamp": "...",
  "data": {
    "result": "FAIL",
    "critical": 0,
    "high": 2,
    "medium": 3,
    "issueIds": [
      "ISSUE-001",
      "ISSUE-002"
    ],
    "artifactId": "ARTIFACT-002"
  }
}
```

仲裁：

```json
{
  "type": "arbitration.completed",
  "timestamp": "...",
  "data": {
    "decision": "developer_solution",
    "reasonSummary": "...",
    "artifactId": "ARTIFACT-003"
  }
}
```

---

# 十六、建议至少定义以下 Timeline Event

根据当前项目状态机进行适配：

```text
task.created

task.started

task.cancel.requested

task.cancelled

task.suspended

task.resumed

project.context.loaded

task.analyzed

plan.completed

development.started

development.completed

verification.started

verification.completed

review.started

review.completed

fix.started

fix.completed

arbitration.started

arbitration.completed

task.completed

task.failed
```

不要过度细化。

保持稳定。

---

# 十七、Artifact

完整大对象应保存为 Artifact。

例如：

```text
test result

test log

review result

review issues

git diff snapshot

architect decision

executor output
```

Task Timeline 只保存：

```text
artifactId
```

或：

```text
artifact reference
```

如果项目现在已有 ArtifactStore：

直接复用。

如果没有：

实现一个最小版本即可。

不要过度设计。

至少支持：

```text
createArtifact()

getArtifact()

关联 taskId

type

createdAt
```

---

# 十八、Artifact 也必须脱敏

写入 Artifact Store 前：

```text
SecretRedactor
```

同样必须执行。

---

# 十九、P2：Skills 模板

补充：

```text
src/skills/

planning/
└── SKILL.md

code-review/
└── SKILL.md

bug-fix/
└── SKILL.md

testing/
└── SKILL.md
```

如果当前项目已有不同 Skill 目录规范：

遵守现有规范。

不要为了本提示词强行调整目录。

---

# 二十、planning Skill

至少定义：

```text
职责

输入

分析步骤

输出

禁止事项
```

输入：

```text
Task

ProjectContext

Project Rules
```

输出：

```text
目标

影响范围

可能修改文件

实施步骤

风险

验收标准
```

Planner 默认不得修改代码。

---

# 二十一、code-review Skill

输入：

```text
Task

ProjectContext

Git Diff

Test Result

Existing Issues
```

检查：

```text
Correctness

Regression

Concurrency

Security

Performance

Maintainability

Project Rules
```

输出：

```text
ReviewResult

ReviewIssue[]
```

限制：

```text
Reviewer 默认禁止修改业务代码。
```

---

# 二十二、bug-fix Skill

输入：

```text
Task

Review Issues

ProjectContext

Current Diff
```

要求：

```text
只处理当前 Issue

禁止无关重构

必须说明每个 Issue 如何修复

无法修复必须明确返回 BLOCKED 或等价状态
```

---

# 二十三、testing Skill

输入：

```text
Task

ProjectContext

Changed Files
```

负责：

```text
确定需要执行的测试

运行真实测试命令

分析测试输出

产生 VerificationResult
```

必须强调：

> 不能由模型自行声称测试通过。

通过必须来自真实工具执行结果。

---

# 二十四、同时检查以下三个问题

本轮完成以上任务以后，请额外检查以下问题。

仅检查和做必要的小修复。

不要因此进行大型架构调整。

---

## A. 外部任务幂等性

检查：

```text
同一个 externalTaskId
```

被重复 Push / Poll 时：

是否会产生多个 Internal Task。

理想行为：

```text
source + externalTaskId
```

应该具有稳定映射。

如果已经实现：

说明实现位置。

如果没有：

给出最小修复。

---

## B. Task 并发控制

检查同一个 Task 被：

```text
resume

cancel

workflow update

external sync
```

同时修改时是否存在覆盖风险。

如果当前 TaskStore 已支持版本号 / lock / CAS：

说明现状。

如果没有：

至少提出 V1 最小保护方案。

只有风险明确且修复成本较小时才实现。

不要因此重写 Store。

---

## C. Cancel 传播

验证：

```text
POST /tasks/:id/cancel
```

是否真的能停止当前：

```text
Codex CLI

Antigravity CLI

ProcessTool

Local Model Request
```

如果无法全部停止：

明确记录各 Provider 当前取消能力。

不要伪造“已取消”。

区分：

```text
cancel_requested

cancelled
```

---

# 二十五、测试要求

本轮必须补充自动化测试。

至少覆盖：

## Security

```text
ProjectPathGuard

ProcessCommandGuard

SecretRedactor
```

---

## API

```text
POST /tasks

GET /tasks/:id

GET timeline

cancel

resume
```

---

## Timeline

验证：

```text
关键事件存在

Artifact reference 正确

敏感数据已脱敏
```

---

# 二十六、最终必须跑真实验证

完成以后，根据项目实际 package scripts 执行：

```text
lint

typecheck

unit tests

build
```

存在什么就执行什么。

不得伪造执行结果。

---

# 二十七、E2E Acceptance Test

如果当前环境允许，至少跑一条完整测试链：

```text
创建 Task
   ↓
Developer 执行
   ↓
真实 Test
   ↓
Reviewer
   ↓
Fail
   ↓
Developer Fix
   ↓
Re-review
   ↓
Done
```

如果无法真实调用某个外部 Agent：

允许使用现有 mock / test provider。

但：

必须明确哪些是 Mock，哪些是真实执行。

---

# 二十八、代码修改原则

本轮严格遵守：

```text
Minimal Change

Reuse Existing Architecture

No Unrelated Refactor

No Public API Rename Without Consumer Check

No Duplicate Capability

Fail Fast

Structured Output

Real Tool Results
```

---

# 二十九、完成后不要只回答“已完成”

请输出完整检查报告。

必须包含以下章节：

```text
1. 修改摘要

2. 修改文件列表

3. ProjectPathGuard 实现说明

4. ProcessCommandGuard 实现说明

5. SecretRedactor 实现说明

6. REST API 实现说明

7. Timeline / Artifact 实现说明

8. Skills 实现说明

9. 幂等性检查结果

10. 并发控制检查结果

11. Cancel 传播检查结果

12. 自动化测试结果

13. lint / typecheck / build 结果

14. E2E 测试结果

15. 尚未解决的问题

16. 下一阶段建议
```

---

# 三十、特别注意

如果在当前项目代码中发现：

```text
PRD 与实际实现已经存在差异
```

不要立即按 PRD 强行重构。

先遵循：

```text
当前稳定实现
+
本轮明确目标
+
最小改动原则
```

如果确实存在架构冲突：

先说明：

```text
现状

PRD 要求

冲突原因

推荐处理方式
```

再进行最小必要修改。

---

# 最终目标

完成本轮以后，项目应该达到：

```text
AI Engineering Core V1
        │
        ├── Task Gateway
        ├── Mastra Workflow
        ├── Executor / Provider
        ├── Codex / Antigravity / Local Model
        ├── Real Tool Validation
        ├── Review / Fix Loop
        ├── Security Guards
        ├── Task REST API
        ├── Timeline / Artifact Audit
        └── Base Skills
```

达到能够进入：

> **真实项目试运行阶段**

而不是继续扩大架构范围。

请首先阅读并分析当前项目，然后输出：

```text
当前实现状态

本轮修改计划

预计修改文件

潜在风险
```

确认自己的实施方案后，再开始实际修改代码。