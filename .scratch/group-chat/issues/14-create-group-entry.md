# 群组对话修复：创建入口移到筛选旁

Type: task
Status: done

## Acceptance Criteria

- [x] 创建群组图标位于对话搜索/筛选行右侧。
- [x] 图标按钮有可访问名称，点击仍打开现有创建弹窗。
- [x] 创建成功后的列表更新和跳转行为不变。

## Plan

`plans/plan-group-chat-fix-02-create-entry.md`

## Comments

删除底部群组标题行的文字创建按钮，复用现有 `GroupCreateDialog` 和 `onCreated` 回调。已通过 typecheck、discipline 和受影响测试。
