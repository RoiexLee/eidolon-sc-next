# 群组对话票 04：最小文字界面

Status: done

本票把票 03 的群组文字 API 接到应用外壳：群组列表、创建群组、消息记录、引用/@ 目标和明确目标发送。群组通话、主动跟话、成员编辑、数据包和统计继续后置。

## 范围

- 在 `frontend/src/lib/api.ts` 增加群组类型、列表/详情/消息读取、创建和 SSE 文字回合客户端；复用现有 `api`、`json`、`turnOwnKeys`，不改单角色 API。
- 在现有对话列表加入独立的群组区和“创建群组”入口。创建弹窗从已配置角色中选择 2–5 位并提交，成功后进入群组页。
- 新增 `/conversation/group/[groupId]` 和 `GroupConversationView`，在现有双栏外壳中显示群头像、成员名、带作者的消息、引用卡、目标角色选择和输入栏；窄屏支持返回列表。
- `@` 首期用目标角色选择器表达角色 id，引用按钮表达 `reply_to_message_id`；服务端仍是最终校验者。发送期间锁定重复提交，SSE `speaker/delta/done/error` 更新消息和当前 speaker。
- 新增 `frontend/src/lib/groupChat.ts` 纯函数和测试：群组标题/头像成员顺序、当前成员筛选、消息作者展示和引用状态。
- 所有文案进入 `frontend/src/i18n/zh.ts`，图标从 `theme/icons.ts` 语义别名导入；遵守 `frontend/AGENTS.md` 的 Base UI、Tailwind token、无任意颜色规则。

## 不做

- 不改 `ConversationView`、`LiveConversation`、单角色列表排序或通话状态；只把群组路由纳入现有导航外壳，不改变通话持有逻辑。
- 不在本票实现成员增删、离线主动回复、群组通话、通知、好感度、记忆、统计和数据包。

## 验收

- 列表可创建 2–5 人群组并跳转 `/conversation/group/{id}`；选择少于 2 人、超过 5 人或重复角色不能提交。
- 群组页刷新后能读取成员和历史消息；每条角色消息显示作者名称/头像，用户消息与角色消息可区分。
- 选择一位当前成员或点角色消息的引用后发送，浏览器请求带正确 `mention_character_ids` / `reply_to_message_id`；SSE 首个角色事件更新 speaker，done 后出现完整消息，error 显示失败且可重试。
- 未知/已移除目标和跨群引用由服务端错误呈现，不把正文中的 `@` 当成目标。
- `groupChat` 纯函数测试、相关前端单测、TypeScript 检查、`scripts/check-discipline.sh` 和受影响测试通过。
