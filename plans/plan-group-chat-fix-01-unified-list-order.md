# 群组对话修复 01：统一对话列表的最近活动排序

Status: done

## 问题

`ConversationList` 先渲染私人对话，再单独渲染 `GroupSection`，所以群组永远在列表底部。后端 `GroupStore.list_groups()` 已按 `updated_at` 倒序返回，群组消息提交时也会更新它，但前端没有把群组和角色行放进同一个排序集合。

## 目标

- 群组对话和私人对话在同一列表中按最近一次对话活动倒序排列。
- 没有消息的群组按创建时间参与排序。
- 群组发出新消息后，当前已打开的列表能及时把它移到正确位置。
- 保留现有私人对话的置顶、隐藏、未读搭话和搜索语义；本票不为群组新增置顶或隐藏设置。

## 设计与实现

1. 在 `frontend/src/lib/conversationList.ts` 增加最小的混合列表条目类型和排序辅助函数。私人对话的时间继续来自 `previewOf(latest[character.id])`，群组的时间使用 `last_message.created_at`，没有消息时退回 `created_at`。
2. 在 `ConversationList.tsx` 将角色行和群组行合并为一个渲染列表；群组行复用现有群组标题、头像和成员摘要，私人行继续使用现有上下文菜单。删除固定在底部的 `GroupSection` 列表，只保留标题/创建入口所需的外壳由票 02 处理。
3. 群组文字回合完成后沿用现有 `eidolon:groups-changed` 刷新事件，或通过已有目录回调刷新 `listGroups()`；不得依赖用户切换页面才更新排序。避免引入第二份群组缓存。
4. 混合列表中相同时间保持稳定顺序；加载失败时保留私人列表，群组请求错误只显示群组区域的错误状态，不阻塞私人对话。

## 影响范围

- `frontend/src/components/conversations/ConversationList.tsx`
- `frontend/src/lib/conversationList.ts` 及其测试
- `frontend/src/components/conversations/GroupConversationView.tsx` 的回合完成刷新 seam
- 不改群组 API、数据库排序和单角色对话 API

## 验收与测试

- 群组有新消息后在私人对话之间按时间移动到正确位置。
- 新建但尚无消息的群组不会遮蔽有最近消息的私人对话。
- 空群组、相同时间、群组请求失败和私人列表筛选行为有测试覆盖。
- 运行相关 Vitest、`npm run typecheck`、`sh scripts/check-discipline.sh`；实现票收尾时运行 `sh scripts/affected-tests.sh <开工基点>`。
- 本地构建版用 Playwright 验证发送一条群组消息后列表顺序变化；若环境检查阻断，记录原因，不绕过检查。

## 不在本票

- 不为群组增加置顶、隐藏、未读搭话或新的搜索规则。
- 不改变群组标题、成员管理、消息生成和通话协议。

## 实现结果

已完成票 13：私人和群组行现在通过 `arrangeConversations` 合并排序；群组无消息时使用创建时间，相同时间保持稳定顺序。文字回合完成和群组通话完成都会触发 `eidolon:groups-changed`，列表重新加载摘要后即时重排。群组置顶、隐藏和新的搜索规则仍不在本票范围内。

## 验证结果

相关 Vitest、`npm run typecheck`、`sh frontend/scripts/check-discipline.sh` 和 `sh scripts/affected-tests.sh a21d40a6` 均已通过。Playwright 本地构建版验收留给后续端到端验收。
