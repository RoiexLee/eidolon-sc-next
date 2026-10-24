# 群组对话修复：统一对话列表排序

Type: task
Status: done

## Acceptance Criteria

- [x] 群组与私人对话在同一列表中按最近一次对话活动倒序显示。
- [x] 新群组、空群组、相同时间和群组消息后的即时重排有稳定行为。
- [x] 私人对话的置顶、隐藏、未读搭话和现有筛选行为不回归。
- [x] 计划、相关测试、typecheck、discipline 和 affected-tests 完成。

## Plan

`plans/plan-group-chat-fix-01-unified-list-order.md`

## Comments

### 开工说明

后端 `GroupStore.list_groups()` 已按 `updated_at` 倒序，问题在前端把群组固定渲染在 `GroupSection` 底部。本票只建立混合列表排序和群组消息后的刷新 seam，不新增群组置顶/隐藏。

### 票 13 交接

创建入口、群头像、群聊宽度、成员按钮、单成员 `@` 和 `@ 全体成员` 分别由后续修复票处理。

### 实现说明

- 新增 `arrangeConversations`，复用私人对话现有的隐藏、置顶、搜索和未读规则，把群组按最后一条消息时间合并进未置顶列表；空群组回退到创建时间，相同时间保持输入顺序。
- 群组文字回合完成，以及群组通话回合通过目录回调完成后，都派发 `eidolon:groups-changed`，列表重新加载群组摘要并即时重排。
- 群组行暂时继续使用列表内已有的首字母头像和底部创建区域；头像复用、创建入口位置分别留给票 02、03，避免扩大本票范围。

### 验收

- `npm test -- --run src/lib/conversationList.test.ts src/lib/liveGroupConversation.test.ts`：41 tests passed。
- `npm run typecheck`：通过。
- `sh frontend/scripts/check-discipline.sh`：通过。
- `sh scripts/affected-tests.sh a21d40a6`：通过，相关 2 个测试文件共 42 tests passed。
- 未做 Playwright 本地构建版验收；本票保留为后续视觉和端到端验收项。
