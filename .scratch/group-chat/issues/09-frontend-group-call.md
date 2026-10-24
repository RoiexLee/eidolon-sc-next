# 前端群组通话与导航外壳接入

Type: task
Status: done

Blocked by: 08

## Acceptance Criteria

- [x] 群组 `group_id` 请求接入前端 call transport，单角色请求保持兼容。
- [x] 群组拥有独立实时通话会话，处理 speaker-started/ended、流式字幕、done.messages 和终态清理。
- [x] 群组拨号和无 speaker 时显示派生群头像，speaker 回复时切换角色视觉资料。
- [x] `ConversationDirectory`/`NavShell` 持有群组通话，符合 ADR-0018 的换页不断线和离开确认。
- [x] 单角色 LiveConversation、CallLayer、导航和测试不回归。
- [x] 建立并完成本票独立计划。

## Comments

### 票 09 交接

详细设计见 `plans/plan-group-chat-09-frontend-group-call.md`。票 09 已按计划完成 target union/API 事件接缝、独立群组 session、群头像与群组 shell 视觉层。

### 实现说明（票 09）

- `LiveGroupConversation` 独立管理群组消息、speaker、字幕、麦克风、铃声和终态；群组 `done.messages` 只进入群组历史，不进入单角色记录、好感度或奖励。
- 群组通话在外壳中使用结构化 target，换页保留 WebRTC；同组页由页面绘制通话层，其他 shell 页面由 `NavShell` 绘制并显示群头像通话条。
- 群头像消费当前成员可用角色头像，无资料时回退首字；speaker 视觉会切换角色颜色、背景、头像和立绘。

### 验证

- `npm test -- --run`：79 个文件、1172 个测试通过。
- `npm run typecheck`、`sh scripts/check-discipline.sh`、`sh scripts/affected-tests.sh cc283f19` 通过。
- `npm run build` 编译与静态生成通过，但最终被当前 Next.js 安全漏洞阻断检查终止；未升级依赖。

### 后续交接

- 本票保留群组通话专用视觉 adapter，未重写单角色 `CallLayer`；后续如需统一两套视觉壳，应单独拆票并继续保持群组与单角色状态边界。
