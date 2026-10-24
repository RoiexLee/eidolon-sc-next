# 群组对话修复 05：调整成员按钮的位置和图标

Status: draft

## 问题

群聊页首目前先放「成员」文字按钮，再放电话图标；用户希望电话在左、成员在电话右侧，并使用图标减少页首占用。

## 目标

- 页首操作顺序为电话、成员。
- 成员按钮使用现有语义图标，保持与电话键相同的 `icon-lg` 触控尺寸。
- 保留成员管理的禁用条件、弹窗内容和键盘/读屏可用性。

## 设计与实现

1. 在 `GroupConversationView.tsx` 调整两个按钮的 DOM 顺序，让电话按钮先渲染、成员按钮后渲染。
2. 成员按钮改为现有 `GroupIcon`/`UsersIcon` 的语义别名，使用 `variant="ghost" size="icon-lg"`，`aria-label` 使用 `copy.groupConversation.members`；必要时复用项目已有 Tooltip 显示可见提示。
3. 保留 `memberChangesLocked` 对成员按钮的禁用逻辑；通话中按钮仍不能打开成员管理，电话按钮仍负责拨号/展开通话。

## 影响范围

- `frontend/src/components/conversations/GroupConversationView.tsx`
- `frontend/src/theme/icons.ts`（仅在现有别名不足时调整）
- 必要时补充 `frontend/src/i18n` 的无障碍标签

## 验收与测试

- 视觉顺序为电话在左、成员图标在右；两者触控区域不小于现有 `icon-lg`。
- 成员图标按钮能打开现有成员管理弹窗，通话/发送中仍正确禁用。
- 读屏能读出「成员」，不依赖图标本身传达语义。
- 运行相关前端测试、typecheck、discipline，并用本地构建版检查宽窄屏页首。

## 不在本票

- 不改变成员管理的增删规则、成员顺序或群组 API。
- 不改变电话图标、通话层或群头像。
