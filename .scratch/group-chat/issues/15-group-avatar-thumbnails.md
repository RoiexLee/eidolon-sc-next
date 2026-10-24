# 群组对话修复：列表显示角色缩略图

Type: task
Status: done

## Acceptance Criteria

- [x] 群组列表头像使用当前成员的角色 `avatar_url`。
- [x] 缺少缩略图时仍回退到角色名首字，不改变群头像布局。
- [x] 详情页、通话栏和通话层继续复用同一群头像组件。

## Plan

`plans/plan-group-chat-fix-03-group-avatar-thumbnails.md`

## Comments

删除列表中的重复头像实现，扩展共享 `GroupAvatar` 支持列表尺寸并传入角色目录。已通过 typecheck、discipline 和受影响测试。
