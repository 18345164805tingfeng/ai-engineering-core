# AGENTS.md

## AI Engineering Core 核心设计与协作原则

本项目是一个通用多模型软件工程编排系统，旨在通过标准工作流调度多模型/Agent 完成软件开发、测试、评审与修复全链路闭环。

### 1. 核心架构原则

1. **Mastra 只负责工作流编排**：Mastra 负责 Workflow、Step、状态机、重试与治理，不侵入具体模型调用与项目业务逻辑。
2. **Workflow 只调用 Role，不绑定具体模型**：
   - 角色固定：Planner、Developer、Tester、Reviewer、Architect。
   - 禁止在工作流中硬编码直接调用特定模型（如 Codex、Gemini、Qwen）。
3. **Role 与 Executor 解耦**：通过 Executor Router 根据配置、复杂度、健康状况和 Fallback 策略决定实际执行者。
4. **分类封装 Provider**：
   - 完整具备读写环境能力的 Coding Agent 使用 `AgentProvider`（如 Codex CLI、Antigravity）。
   - 纯推理与文本生成的模型使用 `ModelProvider`（如 Ollama、vLLM）。
   - 外部操作统一由 `ToolProvider` 管理。
5. **任务统一网关**：所有外部任务（手动输入、飞书、Jira、GitHub Issue）必须经过 `Task Gateway` 标准化转换为统一的 `Internal Task`。
6. **Reviewer 默认无业务代码修改权**：
   - Developer 拥有修改权。
   - Reviewer 拥有评审权和否决权，默认只允许只读、Diff、Test，禁止写入业务代码。
   - Architect 拥有仲裁权。
7. **测试和构建结果必须来自真实工具执行**：
   - 禁止模型自行声称“代码应该可以通过测试”。
   - 所有测试、Lint、Build 必须真实执行并保留真实 exitCode、stdout、stderr 与执行耗时。
8. **以 Task State 为中心协作**：所有 Agent 围绕统一的 Task State 运转，禁止无限自由聊天或脱离 Task 的无序对话。
9. **Review 修复闭环**：Review 失败后必须由 Developer 针对结构化 Review Issue 逐条修复，并重新触发真实测试与 Review，直到达到最大轮次限制。
10. **通用工作流与项目解耦**：项目差异（如规范、命令、架构约束）统一通过 `Project Context` 注入，工作流引擎本身保持项目无关性。
