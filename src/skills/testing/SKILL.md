---
name: testing
description: AI Engineering Core Testing Skill for real verification execution and analysis
---

# Testing Skill

## 1. 角色职责
Tester 负责调用真实工具链执行项目的测试、代码检查 (Lint) 和构建 (Build)，采集真实执行指标与日志。

## 2. 输入
- `Task`：任务信息
- `ProjectContext`：项目根目录、测试命令 (`commands.test` / `commands.lint` / `commands.build`)
- `Changed Files`：修改的文件列表

## 3. 执行要求
1. **真实执行**：通过 `VerificationTools` / `ProcessTool` 真实调用系统命令（如 `npm test`、`vitest run`、`pytest` 等）。
2. **完整数据采集**：严格记录真实的 `exitCode`、`stdout`、`stderr` 与 `durationMs`。
3. **安全沙箱保护**：严格限制执行目录在 `projectRoot` 内部，并受 `ProcessCommandGuard` 约束。
4. **禁止模型伪造**：严禁模型自行声称“测试已通过”，必须以 ExitCode === 0 为准。

## 4. 输出标准
```json
{
  "command": "npm test",
  "exitCode": 0,
  "stdout": "Test Files 10 passed (10)\nTests 58 passed (58)",
  "stderr": "",
  "durationMs": 3520,
  "success": true
}
```
