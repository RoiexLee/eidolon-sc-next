# 群组对话成员管理

Type: task
Status: done

Blocked by: 09

## Acceptance Criteria

- [x] 已有群组页可以打开成员管理对话框并手动添加角色。
- [x] 已有成员可以移除，历史消息作者不变；当前成员数量始终受 2–5 边界保护。
- [x] 前端 PATCH 请求只发送新增/移除角色 id，单角色和群组通话 API 不回归。
- [x] 保存成功后群组快照、群头像、成员数和回复目标选择器同步更新。
- [x] 通话或文字回合期间不能提交成员变更；后端错误在对话框内可读显示。
- [x] 计划、类型检查、相关测试、discipline 和 affected-tests 完成。

## Comments

### 开工说明

后端成员 PATCH 已在票 02 完成；票 10 只接入前端成员管理，不扩展群名、删除或数据包功能。详细设计见 `plans/plan-group-chat-10-member-management.md`。

### 实现说明（票 10）

新增 `updateGroup`、`GroupMemberDialog`、群组页成员入口和 `LiveGroupConversation.setGroup`。成员差异与 2–5 边界抽为 `groupChat` 纯逻辑接缝；保存失败保留选择，成功后同步页面和外壳持有的通话快照。保留 `ROUND_ROBIN_TARGET`，移除当前目标时才回退成员；若引用消息作者已移除则清除引用。

验证：`npm run typecheck`、44 个相关 Vitest、`sh scripts/check-discipline.sh`、`sh scripts/affected-tests.sh 594031a2` 通过。未执行本地 Playwright，原因和风险已记录在计划的测试章节。

### 票 10 交接

群组列表组件的本地群组摘要缓存没有在本票内增加跨组件同步；如需保存后立即更新列表头像或成员数，另开票接入目录刷新。
