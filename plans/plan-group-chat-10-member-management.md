# 群组对话票 10：成员管理

Status: done

票 09 已完成群组通话前端接入。本票补齐群组的基本生命周期操作：用户在已有群组页手动添加或移除角色，成员顺序、历史作者快照和 2–5 人边界继续由后端负责。后端 `PATCH /api/groups/{group_id}` 已存在，本票只接入它，不改数据库和模型协议。

## 目标

- 群组页首提供“成员”入口，打开成员管理对话框。
- 当前角色和仍可添加的角色以稳定顺序显示，用户可一次选择多个变更。
- 保存时只发送新增和移除的角色 id；保存成功后刷新群组快照并更新回复目标、头像和成员数。
- 群组通话或文字回合进行中禁止打开/提交成员变更，避免违反后端成员快照和 running turn 约束。
- 保持群组至少 2 位、最多 5 位当前成员；不能通过 UI 提交越界变更，后端错误仍显示在对话框中。

## 不变量与边界

1. 角色 id 由 Checkbox 状态产生，客户端不根据名字解析目标。
2. 角色移除只影响未来回复；历史消息继续使用服务端保存的作者快照。
3. 不在本票实现群名编辑、删除群组、邀请、多用户共享或群组数据包。
4. 不在通话或发送文字期间刷新成员列表；按钮禁用是用户提示，后端 409 仍需可读显示。
5. 成员保存失败时保留对话框选择和当前群组数据，允许修正后重试。

## 实现

### API

- 在 `frontend/src/lib/api.ts` 增加 `GroupPatchInput` 和 `updateGroup(groupId, input)`。
- 请求使用 `PATCH /api/groups/{encoded groupId}`、JSON `add_character_ids`/`remove_character_ids`，返回完整 `GroupConversation`。
- 在 `api.test.ts` 验证路径编码、请求方法、请求体和返回值传递；现有创建、文字和通话 API 不变。

### 成员对话框

- 新增 `frontend/src/components/conversations/GroupMemberDialog.tsx`，复用现有 Base UI Dialog、Checkbox、Button 和 `MarkedAvatar`。
- 打开时以 `group.current_members` 初始化选择；可从 `characters` 选择未加入角色，显示当前选中数量。
- 保存前计算集合差异，空变更直接关闭；数量不在 2–5 时禁用保存并显示现有群组文案。
- 保存中锁定关闭和控件；API 错误显示在对话框内，不清空选择。

### 群组页

- `GroupConversationView` 的页首增加成员管理按钮，使用 `GroupMemberDialog`。
- 成功后以返回的完整群组替换本地 `group`，如果当前 `targetId` 已移除则选第一位当前成员；群头像、成员数和 @ 选择器随之更新。
- 通话或 `sending` 时按钮不可用；页面卸载和群组通话持有逻辑不改变。

## 测试与验收

- `api.test.ts`：PATCH 请求体、编码和返回。
- `groupMemberPatch`、`validGroupMemberCount` 覆盖成员差异和 2–5 边界；`LiveGroupConversation.setGroup` 覆盖保存后通话成员快照同步。现有 Vitest 没有 DOM 挂载环境，因此保存失败保留选择由对话框 catch 路径保留状态，未另加组件挂载测试。
- `npm run typecheck`、相关 Vitest、`sh scripts/check-discipline.sh`、提交前 `sh scripts/affected-tests.sh <票 10 开工基点>`。
- 本地构建版 Playwright 验收未执行：当前分支的 `next build` 在编译、类型检查和静态生成后被 Next.js 安全漏洞终止检查拦截，未引入本票代码的构建错误；临时脚本不提交。

## 交接

- 本票完成后，群组“手动添加角色”的核心用户故事成立；群名编辑和删除仍另开票。
- 若后端在运行中的群组回合返回 409，前端只显示后端错误，不绕过锁或重试改变成员。

## 实现结果

- `frontend/src/lib/api.ts` 增加群组成员 PATCH；`GroupMemberDialog` 支持稳定顺序选择、2–5 校验、增删差异和错误重试。
- 群组页保存成功后同步本地群组和 `LiveGroupConversation` 快照，保留轮流回复目标；被移除的角色目标和引用回退/清除，避免下一回合引用已离组角色。
- 未扩展群组列表缓存；返回列表后的摘要刷新仍沿用现有列表刷新机制，另有需要时单开票处理。
