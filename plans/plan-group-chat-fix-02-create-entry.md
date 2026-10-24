# 群组对话修复 02：把创建入口放到对话筛选旁

Status: done

## 问题

当前「创建群组」是群组列表底部标题行上的文字按钮。群组被移入混合对话列表后，这个位置不再合适，也让创建入口必须滚到列表底部才能找到。

## 目标

- 创建按钮位于对话列表顶部搜索/筛选行的右侧。
- 使用现有群组图标，保持图标按钮的触控尺寸和无障碍名称。
- 创建弹窗、2–5 位成员校验和创建后跳转行为保持不变。

## 设计与实现

1. 在 `ConversationList.tsx` 的搜索框与 `ListFilter` 同一行加入 `Button variant="ghost" size="icon-lg"`，使用现有 `GroupIcon`，`aria-label` 使用 `copy.conversationList.createGroup`。
2. 删除 `GroupSection` 标题行上的文字创建按钮；群组行只负责显示和打开群组。
3. 保留 `GroupCreateDialog` 的受控状态和 `onCreated` 回调；成功后更新混合列表并跳转到 `/conversation/group/{id}`。
4. 如项目现有图标按钮规范需要提示文字，复用已有 Tooltip，不在调用处新增一套按钮样式。

## 影响范围

- `frontend/src/components/conversations/ConversationList.tsx`
- 必要时仅补 `frontend/src/i18n/zh.ts`/其他语言的创建按钮无障碍文案
- 不改 `GroupCreateDialog.tsx`、`POST /api/groups` 和成员数量契约

## 验收与测试

- 桌面和窄屏都能在搜索框右侧看到创建群组图标按钮。
- 按钮可用键盘聚焦，读屏名称为「创建群组」，点击后仍打开同一个弹窗。
- 创建成功后新群组进入列表并打开群组页，失败仍在弹窗内显示。
- 运行前端相关 Vitest、`npm run typecheck` 和 discipline 检查；本地构建版验证按钮位置和弹窗流程。

## 不在本票

- 不改变混合列表排序；排序由票 01 负责。
- 不增加群组删除、重命名或批量创建功能。

## 实现结果

创建入口已移到搜索和筛选同一行的最右侧，使用现有 `GroupIcon` 的 `icon-lg` 图标按钮并提供创建群组的无障碍名称。底部群组标题行已删除，创建弹窗和创建后跳转逻辑保持不变。

## 验证结果

已通过前端 typecheck、discipline 检查和受影响测试；本票没有改变群组 API 或创建校验。
