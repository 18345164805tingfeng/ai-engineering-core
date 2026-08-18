---
name: bug-fix
description: AI Engineering Core Developer Fix Skill for addressing structured review issues
---

# Bug Fix Skill

## 1. 角色职责
Developer 根据 Reviewer 提出的结构化 Review Issues 逐条进行针对性修复，并重新发起验证。

## 2. 输入
- `Task`：当前任务状态与需求
- `Review Issues`：Reviewer 输出的结构化问题列表（含 severity、file、evidence、suggestion）
- `ProjectContext`：项目上下文与规则
- `Current Diff`：当前代码修改与最新测试反馈

## 3. 修复要求
1. **逐条响应**：必须针对每一个 Issue 提供明确的修复动作或合理解释。
2. **最小范围修改**：只修改当前 Issue 必需的代码，禁止无关重构或扩散性修改。
3. **防回归测试**：同步补充或修复失败的单元测试。
4. **无法修复处理**：若 Issue 与核心架构冲突或无法解决，必须明确返回 BLOCKED 并说明阻碍原因。

## 4. 输出标准
```json
{
  "fixes": [
    {
      "issueId": "ISSUE-1-001",
      "status": "fixed",
      "files": ["src/user/service.ts"],
      "description": "增加了 delete 前的数据依赖性检查"
    }
  ]
}
```
禁止输出模糊回复（如“已修复全部问题”）。
