# 群组对话修复：输入 `@` 自动选择成员

Type: task
Status: done

## Acceptance Criteria

- [x] 删除常驻的目标选择器。
- [x] 在输入框的 `@` token 后显示当前成员候选，并支持过滤、键盘和鼠标选择。
- [x] 选择后提交单个成员 id；删除 token 后不保留过期的目标。
- [x] 没有 `@` 时保留后端轮流回复，引用消息继续使用引用作者。
- [x] 暂不做输入内容变色或富文本编辑器迁移。

## Plan

`plans/plan-group-chat-fix-06-at-autocomplete.md`

## Comments

复用 `matchesSearch`、`MarkedAvatar` 和现有发送契约，新增 `groupMentionAt` 纯函数，候选列表以内联弹层贴在原生 `Textarea` 上方，并通过 ref 恢复选择后的焦点和光标。已通过 typecheck、discipline 和相关 Vitest。
