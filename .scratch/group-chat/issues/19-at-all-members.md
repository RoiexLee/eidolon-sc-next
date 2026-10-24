# 群组对话修复：支持 `@全体成员`

Type: task
Status: done

## Acceptance Criteria

- [x] `@` 候选中提供全体成员选项，选择后发送独立的全体目标字段。
- [x] 服务端按当前成员位置顺序逐个生成，每位成员至多一条回复。
- [x] 中途失败保留已完成消息并返回部分完成状态；首位失败不落半条消息。
- [x] 全体目标与单成员、引用目标互斥，单成员/轮流/群组通话行为不回归。
- [x] 不实现输入内容变色或富文本编辑器迁移。

## Plan

`plans/plan-group-chat-fix-07-at-all-members.md`

## Comments

新增 `mention_all` 请求字段，扩展群组引擎和存储以支持同一回合的多条角色消息，并保留原有 SSE 事件结构。已通过群组接口测试、前端 Vitest、typecheck、目标文件 pyright 和 discipline。
