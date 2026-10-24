# 群组对话票 11：列表摘要刷新

Status: done

票 10 已完成群组页成员管理，但 `ConversationList` 的群组摘要只在账号变化时加载一次。宽屏下列表栏会继续挂载，用户从成员管理返回列表时可能看到旧成员数或旧派生群组头像。本票只修复这个缓存时机，不改变群组 API、排序和单角色列表。

## 目标

- 群组列表离开或重新选中群组时读取最新摘要。
- 成员管理后的成员数、群组标题和派生头像在返回列表时同步。
- 创建群组的现有即时插入和单角色列表行为保持不变。

## 实现

- 调整 `frontend/src/components/conversations/ConversationList.tsx` 的群组列表加载 effect，使其依赖 `selectedGroupId`；账号或选中群组变化时重新调用已有 `listGroups()`。
- 保留现有 active 标记和错误显示，避免旧请求覆盖新账号/新页面状态。
- 成功刷新时清除上一轮群组加载错误，失败后可以恢复显示新摘要。
- 不新增 Directory 状态、事件总线或 API；列表仍使用现有 `GroupConversation` 快照和排序顺序。

## 测试与验收

- 运行 `npm run typecheck`、相关 Vitest、`sh scripts/check-discipline.sh` 和提交前 `sh scripts/affected-tests.sh <票 11 开工基点>`。
- 本地构建版 Playwright 若构建检查允许，验证群组页修改成员后返回列表，成员数和头像取到新快照；临时脚本不提交。

## 实现结果

列表在账号或当前群组选择变化时重新读取群组摘要，并在成功响应后清除旧错误；请求的 active 标记继续防止过期响应覆盖当前状态。未新增状态、事件或接口。

验证：typecheck、39 项相关 Vitest、discipline 通过；本地 Playwright 未执行，沿用票 10 记录的 Next.js 构建安全检查阻断。

## 交接

- 本票只覆盖列表重新进入/切换时的刷新；停留在群组页时的页面快照同步已由票 10 完成。
