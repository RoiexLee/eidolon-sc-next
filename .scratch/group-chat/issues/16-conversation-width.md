# 群组对话修复：消息区域与私人聊天同宽

Type: task
Status: done

## Acceptance Criteria

- [x] 群聊消息区不再使用独立的页面级 `max-w-2xl` 限制。
- [x] 单条用户和角色气泡仍保持原有最大宽度。
- [x] 输入栏、滚动区和通话层结构不变。

## Plan

`plans/plan-group-chat-fix-04-conversation-width.md`

## Comments

仅移除群聊消息列的固定最大宽度，保持现有消息顺序、引用、流式回复和通话逻辑。已通过 typecheck、discipline 和受影响测试。
