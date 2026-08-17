# AI Engineering Core V1

> 通用多模型 AI 软件开发流水线 —— PRD + 可执行开发计划

**文档版本：** V1.0  
**目标：** 构建一套与具体项目无关、可复用于后续所有软件项目的 AI 软件工程执行系统。  
**核心编排：** Mastra  
**第一版主要执行者：** Codex CLI、Antigravity / Gemini、Qwen Local  
**开发方式：** 使用 Gemini 按本文档分阶段实施

---

## 1. 项目背景

当前希望形成一套长期可复用的 AI 软件开发流程，而不是针对某一个 Vue、Java、Python 或其他具体项目编写临时 Agent。

系统需要做到：

1. 任务可以来自手动输入、任务平台、飞书以及后续其他平台。
2. 外部任务统一转换成内部 Task。
3. Mastra 只负责工作流编排，不直接绑定具体模型。
4. Developer、Reviewer、Planner、Architect 等是稳定角色。
5. Codex、Gemini、Qwen 等只是可替换的执行资源。
6. Developer 负责代码修改，Reviewer 默认只有评审和否决权。
7. 测试、Lint、Build 等结果必须来自真实工具执行，不能由模型自行声称通过。
8. Review 失败后自动回到 Developer 修复，再次测试和 Review。
9. 超过最大修复轮数后进入 Architect 仲裁。
10. 云端模型不可用时可以自动降级到其他执行者或本地模型。
11. 工作流不与具体业务项目耦合，项目差异通过 Project Context 注入。

---

# 2. 产品目标

## 2.1 核心目标

建设一个统一的 **AI Engineering Core**，使用户只需要提交一个开发任务，系统即可完成：

```text
获取任务
  ↓
标准化 Task
  ↓
识别项目
  ↓
加载项目上下文
  ↓
任务分析
  ↓
规划
  ↓
开发
  ↓
真实测试
  ↓
Code Review
  ↓
修复闭环
  ↓
必要时仲裁
  ↓
完成并回写结果
```

最终用户不需要知道任务实际由 Codex、Gemini、Qwen 或其他模型执行。

---

## 2.2 V1 成功标准

V1 完成时必须至少跑通以下真实链路：

```text
Manual Task
   ↓
Task Gateway
   ↓
Internal Task
   ↓
Mastra Workflow
   ↓
Codex Developer
   ↓
真实工具验证
   ↓
Antigravity / Gemini Reviewer
   ↓
Fail ?
   ├─ No → Done
   └─ Yes
        ↓
     Codex Fix
        ↓
     Test
        ↓
     Re-review
        ↓
     Done
```

并具备：

- 标准 Task Schema
- Task 状态机
- Codex AgentProvider
- Antigravity AgentProvider
- Ollama / Qwen ModelProvider
- Executor Router
- 基础健康检查与 Fallback
- Project Context Loader
- Review Issue Schema
- Task Timeline
- 手动任务输入

---

# 3. 非目标（V1 暂不实现）

以下内容第一版不作为必须项：

- 完整 Web 管理后台
- 复杂权限系统
- 多租户
- 企业级审计
- 大规模并发任务调度
- 完整 Skills 市场
- 自动创建 PR / 自动 Merge
- 自动部署生产环境
- 大规模 RAG 知识库
- 所有任务平台一次性接入
- 复杂模型评分系统

V1 优先保证 **开发 → 测试 → Review → 修复 → 完成** 的闭环稳定。

---

# 4. 核心设计原则

## 4.1 Role ≠ Model

角色固定：

- Planner
- Developer
- Tester
- Reviewer
- Architect

模型可替换：

- Codex
- Gemini
- Qwen
- Claude
- Mistral
- 后续其他模型

禁止在 Workflow 中写死：

```text
调用 Gemini
调用 Codex
```

Workflow 应写成：

```text
执行 Reviewer Role
执行 Developer Role
```

实际执行者由 Executor Router 决定。

---

## 4.2 Workflow ≠ Project

工作流是通用的。

项目差异来自：

- AGENTS.md
- project.yaml
- README
- package.json / pom.xml / pyproject.toml 等
- Git
- 构建命令
- 测试命令
- 项目架构约束

---

## 4.3 Task 为中心

Agent 不通过自由聊天长期协作。

所有执行者围绕同一个 Task State 工作：

```text
读取 Task
  ↓
执行职责
  ↓
输出结构化结果
  ↓
更新 Task
```

---

## 4.4 Reviewer 默认无修改权

职责：

```text
Developer = 修改权
Reviewer  = 评审权 + 否决权
Architect = 仲裁权
```

Reviewer 默认只允许：

- Read
- Search
- Git Diff
- 有限 Shell
- Test

默认禁止业务代码写入。

---

## 4.5 测试必须来自真实工具

禁止模型输出：

```text
“代码应该可以通过测试。”
```

系统必须实际执行：

```text
lint
unit test
build
e2e
```

并保存真实 stdout / stderr / exitCode。

---

# 5. 总体架构

```text
                    Task Sources
                         │
      ┌──────────────────┼──────────────────┐
      │                  │                  │
   Manual              飞书              任务平台
  CLI/Web             Feishu             Jira/...
      │                  │                  │
      └──────────────────┼──────────────────┘
                         ↓
                 ┌────────────────┐
                 │  Task Gateway  │
                 └───────┬────────┘
                         ↓
                  Internal Task
                         ↓
                Project Resolver
                         ↓
               Project Context
                         ↓
                 Mastra Workflow
                         ↓
                  Execute Role
                         ↓
                Executor Router
                         ↓
       ┌─────────────────┼─────────────────┐
       ↓                 ↓                 ↓
 AgentProvider      ModelProvider      ToolProvider
       │                 │                 │
 ┌─────┴─────┐      ┌────┴────┐       ┌────┴────┐
 │           │      │         │       │         │
Codex   Antigravity Ollama    vLLM    Git      Shell
CLI      CLI/SDK     Qwen      ...    Test      Files
```

---

# 6. 模块划分

## 6.1 Task Gateway

职责：

1. 获取外部任务
2. 标准化为 Internal Task
3. 识别来源
4. 建立 externalTaskId 与 internalTaskId 映射
5. 去重
6. 状态同步
7. 执行结果回写

统一抽象：

```text
TaskSource
├── ManualSource
├── FeishuSource
├── JiraSource
├── GitHubIssueSource
└── GenericWebhookSource
```

V1：

- 必须实现 ManualSource
- FeishuSource 设计接口但可放在 V1.1

---

## 6.2 Project Resolver

职责：

将任务中的项目名称映射到本地项目。

示例：

```yaml
projects:
  bi:
    name: BI Platform
    root: D:/workspace/bi
    aliases:
      - BI
      - BI平台
      - 数据可视化
```

输出：

```json
{
  "projectId": "bi",
  "root": "D:/workspace/bi"
}
```

禁止模型自己猜测本地项目路径。

---

## 6.3 Project Context Loader

进入项目后自动加载：

```text
AGENTS.md
.ai/project.yaml
README.md
package.json / pom.xml / pyproject.toml
Git 状态
项目目录概要
测试 / lint / build 命令
```

输出统一 ProjectContext。

---

## 6.4 Mastra Workflow

Mastra 负责：

- Workflow
- Step
- 状态流转
- Retry
- Suspend / Resume
- Role 调用
- Review Loop
- 最大轮次
- Trace

Mastra 不应该直接负责：

- Codex CLI 具体调用细节
- Antigravity CLI 具体调用细节
- Ollama HTTP 细节
- 项目规则解析实现

---

## 6.5 Executor Router

职责：

根据以下因素选择实际 Executor：

- role
- complexity
- risk
- provider health
- local/cloud preference
- latency
- fallback

统一调用：

```js
executeRole({
  role: 'developer',
  task,
  projectContext,
})
```

而不是：

```js
runCodex(...)
```

---

# 7. Executor 体系

## 7.1 Executor

所有执行资源统一抽象成 Executor。

```text
Executor
├── AgentExecutor
└── ModelExecutor
```

建议接口：

```js
class Executor {
  getId()
  execute(request)
  healthCheck()
  cancel(runId)
  getCapabilities()
}
```

---

## 7.2 AgentProvider

用于完整 Coding Agent。

V1：

```text
AgentProvider
├── CodexProvider
└── AntigravityProvider
```

### CodexProvider

用途：

- Developer
- Fix Developer

第一版优先通过本地 Codex CLI 调用，不强制 OpenAI API。

能力：

```text
read
write
search
shell
git
test
```

---

### AntigravityProvider

用途：

- Planner
- Reviewer
- 后续 Architect

第一版：

```text
Antigravity CLI Adapter
```

未来：

```text
Antigravity SDK Adapter
```

上层接口不改变。

---

## 7.3 ModelProvider

用于纯模型。

V1：

```text
ModelProvider
└── OllamaProvider
      └── Qwen Local
```

用途：

- Task Router
- 简单任务分析
- Fallback
- 日志分析

后续：

```text
VllmProvider
OpenAIProvider
GeminiProvider
AnthropicProvider
```

---

# 8. 初始角色分配

V1 推荐：

```yaml
roles:
  router:
    primary: qwen-local

  planner:
    primary: antigravity-planner
    fallback:
      - qwen-local

  developer:
    primary: codex
    fallback:
      - qwen-coder-local

  reviewer:
    primary: antigravity-reviewer
    fallback:
      - qwen-reviewer-local

  architect:
    primary: antigravity-architect
    fallback:
      - qwen-architect-local
      - human
```

注意：具体 Gemini 型号由 Antigravity 内部配置管理，不应写进 Mastra Workflow。

---

# 9. Task Schema

建议 V1：

```json
{
  "id": "TASK-20260817-001",
  "source": {
    "type": "manual",
    "externalId": null,
    "sync": false
  },
  "project": {
    "id": "demo",
    "root": "D:/workspace/demo"
  },
  "requirement": {
    "title": "增加用户删除功能",
    "description": "",
    "constraints": []
  },
  "priority": "normal",
  "mode": "auto",
  "status": "CREATED",
  "analysis": {
    "type": null,
    "complexity": null,
    "risk": null
  },
  "plan": null,
  "execution": {
    "round": 0,
    "changes": []
  },
  "verification": {
    "results": []
  },
  "review": {
    "round": 0,
    "result": null,
    "issues": []
  },
  "arbitration": null,
  "timeline": [],
  "createdAt": null,
  "updatedAt": null
}
```

---

# 10. Review Issue Schema

Reviewer 必须输出结构化数据。

```json
{
  "result": "FAIL",
  "issues": [
    {
      "id": "ISSUE-001",
      "severity": "high",
      "category": "correctness",
      "file": "src/user/service.js",
      "location": "deleteUser",
      "description": "删除前未检查关联数据",
      "evidence": "...",
      "suggestion": "增加关联数据检查"
    }
  ]
}
```

severity：

```text
critical
high
medium
low
```

category 建议：

```text
correctness
regression
security
performance
concurrency
architecture
maintainability
project-rule
test
```

---

# 11. Developer Fix Result

Developer 修复时必须逐条响应 Review Issue：

```json
{
  "fixes": [
    {
      "issueId": "ISSUE-001",
      "status": "fixed",
      "files": [
        "src/user/service.js"
      ],
      "description": "增加删除前关联数据检查"
    }
  ]
}
```

禁止简单回复：

```text
已修复全部问题。
```

---

# 12. Task 状态机

V1 推荐：

```text
CREATED
  ↓
LOADING_CONTEXT
  ↓
ANALYZING
  ↓
PLANNING
  ↓
CODING
  ↓
VERIFYING
  ↓
REVIEWING
  │
  ├── PASS → FINALIZING → DONE
  │
  └── FAIL → FIXING
                ↓
            VERIFYING
                ↓
            REVIEWING
```

异常：

```text
WAITING_FOR_CONTEXT
WAITING_FOR_APPROVAL
NEED_ARBITRATION
BLOCKED
FAILED
CANCELLED
```

---

# 13. Review Loop

默认：

```yaml
review:
  maxRounds: 3
```

流程：

```text
Review Round 1
   ↓ FAIL
Fix
   ↓
Test
   ↓
Review Round 2
   ↓ FAIL
Fix
   ↓
Review Round 3
   ↓ FAIL
NEED_ARBITRATION
```

Architect 仲裁后只允许一个 Final Fix Round。

---

# 14. Workflow Mode

## Fast

适合：

- 文案
- 小样式
- 小配置
- 极低风险修改

```text
Analyze
 ↓
Develop
 ↓
Verify
 ↓
Done
```

---

## Standard

默认：

```text
Analyze
 ↓
Plan
 ↓
Develop
 ↓
Verify
 ↓
Review
 ↓
Fix Loop
 ↓
Done
```

---

## Strict

适合：

- 权限
- 安全
- 数据库迁移
- 支付
- 核心架构
- 大规模重构

```text
Analyze
 ↓
Plan
 ↓
Architect Plan Review
 ↓
Develop
 ↓
Verify
 ↓
Deep Review
 ↓
Fix Loop
 ↓
Final Verify
 ↓
Done
```

V1 可以先实现 Standard，Fast / Strict 保留接口。

---

# 15. ToolProvider

统一管理真实工具。

建议：

```text
tools/
├── filesystem
├── git
├── shell
├── test
├── lint
└── build
```

角色权限：

| Role | Read | Write | Shell | Git | Test |
|---|---:|---:|---:|---:|---:|
| Planner | ✓ | × | 有限 | ✓ | × |
| Developer | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reviewer | ✓ | × | 有限 | ✓ | ✓ |
| Tester | ✓ | × | ✓ | ✓ | ✓ |
| Architect | ✓ | × | 有限 | ✓ | × |

---

# 16. 模型与执行者健康检查

网络不稳定是系统必须考虑的场景。

Executor 状态：

```text
HEALTHY
DEGRADED
UNAVAILABLE
CIRCUIT_OPEN
```

建议记录：

```json
{
  "executor": "antigravity-reviewer",
  "status": "healthy",
  "consecutiveFailures": 0,
  "latencyMs": 1200,
  "lastSuccessAt": "...",
  "circuit": "closed"
}
```

Fallback：

```text
Primary
  ↓ unavailable
Fallback #1
  ↓ unavailable
Fallback #2
  ↓
Human
```

V1 可以先实现：

- healthCheck
- request timeout
- 失败自动 fallback

Circuit Breaker 可放 V1.1。

---

# 17. Task Gateway Source Adapter

统一接口建议：

```js
class TaskSource {
  async fetch()
  async get(externalId)
  async acknowledge(externalId)
  async updateStatus(externalId, status)
  async postResult(externalId, result)
}
```

### ManualSource

V1 必须实现。

输入：

```json
{
  "project": "demo",
  "requirement": "增加用户删除功能"
}
```

---

### FeishuSource

V1.1 建议实现。

支持：

```text
任务获取
项目字段映射
标签触发
状态同步
结果回写
```

建议只让满足以下条件的任务自动进入 AI 开发：

```text
标签 = AI开发
状态 = 待开发
```

不要扫描全部飞书任务后由模型随意决定。

---

# 18. 项目目录结构

建议以 Mastra 初始化项目后扩展：

```text
ai-engineering-core/
│
├── src/
│   ├── mastra/
│   │   ├── index.js
│   │   ├── workflows/
│   │   │   └── software-development.js
│   │   ├── agents/
│   │   │   ├── router.js
│   │   │   ├── planner.js
│   │   │   ├── developer.js
│   │   │   ├── reviewer.js
│   │   │   ├── tester.js
│   │   │   └── architect.js
│   │   └── tools/
│   │
│   ├── gateway/
│   │   ├── task-gateway.js
│   │   ├── sources/
│   │   │   ├── manual.js
│   │   │   └── feishu.js
│   │   ├── normalizer/
│   │   │   └── task-normalizer.js
│   │   └── sync/
│   │       └── task-sync.js
│   │
│   ├── task/
│   │   ├── schema/
│   │   ├── store/
│   │   └── state/
│   │
│   ├── project/
│   │   ├── project-resolver.js
│   │   └── context-loader.js
│   │
│   ├── executors/
│   │   ├── executor.js
│   │   ├── agent/
│   │   │   ├── codex.js
│   │   │   └── antigravity.js
│   │   └── model/
│   │       └── ollama.js
│   │
│   ├── router/
│   │   ├── executor-router.js
│   │   └── health-manager.js
│   │
│   └── skills/
│       ├── planning/
│       ├── code-review/
│       ├── bug-fix/
│       └── testing/
│
├── config/
│   ├── executors.yaml
│   ├── roles.yaml
│   ├── workflow.yaml
│   └── projects.yaml
│
└── package.json
```

---

# 19. 配置设计

## executors.yaml

```yaml
executors:
  codex:
    type: agent
    provider: codex-cli

  antigravity-reviewer:
    type: agent
    provider: antigravity
    agent: reviewer

  antigravity-planner:
    type: agent
    provider: antigravity
    agent: planner

  qwen-local:
    type: model
    provider: ollama
    model: qwen
```

---

## roles.yaml

```yaml
roles:
  router:
    primary: qwen-local

  planner:
    primary: antigravity-planner
    fallback:
      - qwen-local

  developer:
    primary: codex
    fallback:
      - qwen-local

  reviewer:
    primary: antigravity-reviewer
    fallback:
      - qwen-local

  architect:
    primary: antigravity-architect
    fallback:
      - qwen-local
      - human
```

---

## workflow.yaml

```yaml
workflow:
  defaultMode: standard

review:
  maxRounds: 3

execution:
  timeoutSeconds: 1800

fallback:
  enabled: true
```

---

# 20. API 设计（V1）

## 创建手动任务

```text
POST /tasks
```

Request：

```json
{
  "project": "demo",
  "requirement": {
    "title": "增加用户删除功能",
    "description": "",
    "constraints": []
  }
}
```

Response：

```json
{
  "taskId": "TASK-001",
  "status": "CREATED"
}
```

---

## 查询任务

```text
GET /tasks/:id
```

---

## 查询 Timeline

```text
GET /tasks/:id/timeline
```

---

## 取消任务

```text
POST /tasks/:id/cancel
```

---

## Resume

```text
POST /tasks/:id/resume
```

用于 WAITING_FOR_CONTEXT / WAITING_FOR_APPROVAL。

---

# 21. Timeline

所有关键行为必须写入 Timeline。

例如：

```json
[
  {
    "type": "TASK_CREATED",
    "at": "..."
  },
  {
    "type": "DEVELOPER_STARTED",
    "executor": "codex",
    "at": "..."
  },
  {
    "type": "VERIFY_COMPLETED",
    "result": "PASS",
    "at": "..."
  },
  {
    "type": "REVIEW_COMPLETED",
    "result": "FAIL",
    "issues": 2,
    "at": "..."
  }
]
```

V1 不要求复杂 UI，但数据必须保留。

---

# 22. 安全与边界

V1 至少实现：

1. 所有 Task 必须绑定 projectRoot。
2. 文件操作不得越出 projectRoot。
3. Shell 默认 cwd = projectRoot。
4. 危险命令可以配置 denylist。
5. Reviewer 默认禁止 write。
6. 删除大量文件、数据库破坏性操作等可进入 WAITING_FOR_APPROVAL。
7. 日志不得直接输出 API Key / Token。
8. Provider 密钥只能通过环境变量读取。

---

# 23. 开发阶段划分

## Phase 0：Mastra 初始化

目标：建立可运行项目。

任务：

- 使用 Mastra 官方方式初始化项目
- 确认开发命令
- 确认 Workflow 可运行
- 建立基础目录

验收：

```text
Mastra 项目可以启动
最简单 Workflow 可以执行
```

---

## Phase 1：Task Core

实现：

- Task Schema
- Task Store
- Task State
- Timeline
- ManualSource
- Task Gateway

验收：

```text
POST /tasks
→ 创建 Task
→ 可以查询状态和 Timeline
```

暂时不调用任何模型。

---

## Phase 2：Project Context

实现：

- projects.yaml
- Project Resolver
- Context Loader
- AGENTS.md 读取
- README / Git / commands 读取

验收：

```text
Task(project=demo)
→ 正确解析 projectRoot
→ 生成 ProjectContext
```

---

## Phase 3：Executor Core

实现：

- Executor Interface
- AgentExecutor
- ModelExecutor
- Executor Registry
- Executor Router

先使用 Mock Executor 测试。

验收：

```text
executeRole('developer')
→ 可以根据配置解析到 executor
```

---

## Phase 4：Codex Adapter

实现：

- CodexProvider
- CLI 启动
- projectRoot 工作目录
- stdout/stderr
- timeout
- cancel
- 结果转换

验收：

```text
Mastra
→ Developer Role
→ Codex CLI
→ 修改测试项目中的真实文件
```

---

## Phase 5：真实验证工具

实现：

- Shell Tool
- Test Tool
- Lint Tool
- Build Tool
- Process Result Schema

验收：

真实执行项目命令，并保存：

```text
command
exitCode
stdout
stderr
duration
```

---

## Phase 6：Antigravity Reviewer

实现：

- AntigravityProvider
- Reviewer Agent
- Git Diff 输入
- Requirement 输入
- Project Context 输入
- Review Issue JSON 输出校验

验收：

```text
Codex 修改代码
→ Antigravity Reviewer
→ 返回合法 ReviewResult
```

---

## Phase 7：Review Fix Loop

实现：

```text
Develop
→ Verify
→ Review
→ Fail
→ Fix
→ Verify
→ Review
```

并限制：

```text
maxRounds = 3
```

验收：

人为制造一个 Review 问题，系统可以完成完整修复闭环。

---

## Phase 8：Qwen Local 与 Fallback

实现：

- OllamaProvider
- healthCheck
- fallback
- Router Role

验收：

手动让主要 Provider 不可用：

```text
Primary Fail
→ 自动使用 Qwen Local
```

---

## Phase 9：Planner / Architect

实现：

- Planner Role
- Architect Role
- NEED_ARBITRATION
- Final Fix Round

验收：

超过最大 Review 轮数能够进入 Architect。

---

## Phase 10：飞书接入

在核心闭环稳定后实施。

实现：

- FeishuSource
- Task mapping
- 状态同步
- 结果回写
- Trigger Rules

验收：

```text
飞书任务
→ Internal Task
→ 开发完成
→ 自动回写飞书状态和结果
```

---

# 24. Gemini 开发执行规则

使用 Gemini 开发本项目时，建议严格遵守以下规则。

## 每个 Phase 单独开发

禁止一次性实现全部内容。

执行顺序：

```text
Phase N
 ↓
分析现有代码
 ↓
输出修改计划
 ↓
用户/当前任务确认范围
 ↓
实施
 ↓
运行验证
 ↓
输出变更说明
 ↓
再进入 Phase N+1
```

---

## 修改原则

Gemini 必须遵守：

1. 只修改当前 Phase 必需内容。
2. 不做无关重构。
3. 不提前实现后续 Phase。
4. 新增抽象必须有当前实际使用场景。
5. 公共接口变更前检查全部消费者。
6. 所有 CLI / Provider 调用必须有 timeout。
7. 外部进程失败不得伪造成功结果。
8. Schema 输入输出必须校验。
9. Workflow 中不得写死具体模型。
10. Provider 内不得承担 Workflow 状态逻辑。

---

# 25. 给 Gemini 的项目启动提示词

可以将下面内容作为本项目第一次开发任务的开场指令：

```text
你正在开发一个名为 AI Engineering Core 的通用多模型软件工程编排系统。

请严格阅读当前仓库中的：
1. AGENTS.md
2. AI-Engineering-Core-V1-PRD-实施计划.md
3. package.json
4. src/mastra 现有结构

本项目核心原则：

- Mastra 只负责工作流编排。
- Workflow 只调用 Role，不直接绑定 Codex、Gemini、Qwen 等模型。
- Role 与 Executor 解耦。
- 完整 Coding Agent 使用 AgentProvider。
- 纯模型使用 ModelProvider。
- 所有外部任务先经过 Task Gateway 转成 Internal Task。
- Reviewer 默认无业务代码修改权。
- 测试和构建结果必须来自真实工具执行。
- 所有 Agent 围绕 Task State 协作，不进行无限自由聊天。
- Review 失败后由 Developer 修改，再重新测试和 Review。

现在只实施 Phase 0：Mastra 初始化和基础项目结构。

要求：
1. 先检查当前仓库状态。
2. 给出最小修改计划。
3. 不实施 Phase 1 及后续内容。
4. 保持目录清晰，但不要为了未来可能性进行过度设计。
5. 完成后运行项目已有的 lint/test/build 或等价检查。
6. 最后输出：修改文件、实现内容、验证结果、下一阶段建议。
```

---

# 26. 每个 Phase 推荐任务模板

后续可以直接给 Gemini：

```text
请继续实施《AI Engineering Core V1》中 Phase X。

开发前：
- 阅读 PRD 对应 Phase。
- 检查当前实际实现，不假定上一阶段一定完整。
- 列出本阶段需要修改/新增的文件。

开发要求：
- 只实现 Phase X。
- 不提前开发后续阶段。
- 保持现有架构和公共接口兼容。
- 对输入输出进行必要校验。
- 所有外部调用必须正确处理错误和 timeout。

开发后：
- 执行当前阶段可以运行的真实验证。
- 输出修改文件清单。
- 输出验证命令与结果。
- 输出仍未完成的内容。
```

---

# 27. V1 最终验收场景

准备一个真实测试仓库，输入：

```text
项目：demo-project
需求：增加一个简单的新功能，并补充测试。
```

系统必须自动完成：

```text
1. ManualSource 接收任务
2. Task Gateway 创建 Internal Task
3. Project Resolver 定位仓库
4. Project Context Loader 加载规则
5. Mastra 启动 Standard Workflow
6. Developer → Codex
7. Codex 修改代码
8. Tester 执行真实测试
9. Reviewer → Antigravity / Gemini
10. 如果 FAIL，生成结构化 Review Issue
11. Codex 根据 Issue 修复
12. 再次测试
13. 再次 Review
14. PASS
15. Task 状态变成 DONE
16. Timeline 保存全过程
17. 输出最终 Change Summary
```

最终必须可以回答：

```text
谁修改了代码？
谁 Review？
执行了哪些命令？
哪些测试真实通过？
Reviewer 提出了哪些问题？
每个 Issue 如何修复？
最终改了哪些文件？
任务为什么被判定为完成？
```

---

# 28. V1 Definition of Done

以下全部满足，才认为 V1 完成：

- [ ] Mastra Workflow 正常运行
- [ ] Task Gateway 与 Workflow 解耦
- [ ] ManualSource 正常工作
- [ ] Internal Task Schema 稳定
- [ ] Project Resolver 正常
- [ ] Project Context 可加载
- [ ] Executor 接口稳定
- [ ] Codex CLI 可作为 Developer
- [ ] Antigravity 可作为 Reviewer
- [ ] Qwen Local 可作为基础 Fallback
- [ ] Reviewer 输出结构化 Review Issue
- [ ] Developer 可以逐 Issue 修复
- [ ] Test / Lint / Build 使用真实工具
- [ ] Review Loop 可运行
- [ ] 最大 Review 轮数生效
- [ ] Provider 失败可以 fallback
- [ ] Timeline 可追溯
- [ ] 项目规则不写入通用 Workflow
- [ ] Workflow 不绑定具体模型版本
- [ ] 一个真实项目从 Task 到 Done 完整跑通

---

# 29. 后续版本方向

V1 稳定后再逐步增加：

```text
V1.1
├── Feishu Source
├── Circuit Breaker
├── Fast / Strict Workflow
└── Architect Arbitration

V1.2
├── Web Dashboard
├── Task Timeline UI
├── Executor Health UI
└── Review Dashboard

V1.3
├── Jira / GitHub / GitLab Adapter
├── Skills Registry
├── Model Capability Registry
└── 成本 / Token / Latency 统计

V2
├── 多项目并发
├── 自动 PR
├── Human Approval Center
├── Team / Permission
└── 企业级审计与可观测性
```

---

# 30. 最终架构原则总结

```text
任务从哪里来
      ↓
Task Gateway

任务是什么
      ↓
Internal Task

属于哪个项目
      ↓
Project Resolver

项目有什么规则
      ↓
Project Context

流程怎么跑
      ↓
Mastra Workflow

当前需要什么角色
      ↓
Role

具体由谁执行
      ↓
Executor Router

完整 Agent 还是纯模型
      ↓
AgentProvider / ModelProvider

真实操作
      ↓
ToolProvider

结果回哪里
      ↓
Task Gateway
```

长期必须坚持：

> **Workflow 不绑定模型。**  
> **Role 不绑定 Provider。**  
> **Project 不侵入通用 Workflow。**  
> **Task 是整个系统协作的唯一中心。**  
> **模型可以持续替换，架构不因此重写。**

