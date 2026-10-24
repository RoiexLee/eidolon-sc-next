# 群组对话列表摘要刷新

Type: task
Status: done

Blocked by: 10

## Acceptance Criteria

- [x] 宽屏列表栏在离开或重新选中群组后显示最新群组成员数、标题和派生头像。
- [x] 账号切换/重新加载时仍正确取群组列表，旧请求不能覆盖当前状态。
- [x] 创建群组的即时插入、列表顺序和单角色列表行为不回归。
- [x] 计划、类型检查、相关测试和 discipline 完成。

## Comments

### 开工说明

票 10 已同步群组页和外壳通话快照；本票只处理已挂载 `ConversationList` 的群组摘要重新取数，不引入新的跨组件状态。

### 实现说明（票 11）

`ConversationList` 的 `listGroups` effect 现在同时依赖账号和 `selectedGroupId`，请求成功时更新摘要并清除旧错误；active 清理保持不变。没有改变创建群组的即时插入、排序或单角色列表。

验证：`npm run typecheck`、39 项相关 Vitest、`sh scripts/check-discipline.sh` 通过。构建版 Playwright 未执行，原因记录在计划中。
