# 群组对话修复：成员入口改为右侧图标

Type: task
Status: done

## Acceptance Criteria

- [x] 页首按钮顺序为电话在左、成员在右。
- [x] 成员入口使用 `icon-lg` 图标按钮，不再显示文字按钮。
- [x] 成员弹窗、禁用条件和读屏名称保持可用。

## Plan

`plans/plan-group-chat-fix-05-member-button.md`

## Comments

复用现有 `GroupIcon`，只调整页首按钮顺序和成员按钮外观，未改变成员管理逻辑。
