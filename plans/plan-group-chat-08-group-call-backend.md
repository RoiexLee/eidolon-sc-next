# 群组对话票 08：后端群组通话纵切

Status: done

本票把群组通话接到现有 WebRTC 管线，但只改后端。一次通话在接通时复制当前成员和音色快照，群组回合沿用文字阶段的成员轮流与最多一次追加回复；音频仍是一条轨道，角色按顺序切换音色。

## 范围

- `CallRequest` 和 ICE 预检接受互斥的 `conversation_id` / `group_id`，群组请求只允许创建者使用，成员不足或角色已下线时拒绝。
- 新增群组通话 admission：占用一次通话限额，但不把群组伪装成 `activity_records.character_id`，也不触发单角色冷却、好感度或结束对话。
- 新增 `GroupCallTarget` 与 `GroupCallTurns`，在真实 WebRTC 数据通道中发送 `user`、`speaker-started`、`speaker-ended`、`delta`、`done`、`error`，回合结果写入既有群组消息/回合表。
- speaker 切换前先结束上一个 TTS segment，再用 `TTSUpdateSettingsFrame` 切换 Fish Audio 的 voice；同一回合内不并行发声，切换或服务失败交给现有通话失败处理。
- 单角色通话入口、活动记录和前端导航保持不变；群组头像、字幕/立绘外壳和页面拨号入口留给后续前端票。

## 验收

- 两位当前成员可以通过 `/api/offer` 的 `group_id` 建立真实 WebRTC 通话；成员快照不会因通话期间的成员变更而改变。
- 一个用户回合可产生主 speaker 和一次追加 speaker，speaker 事件成对且严格串行，最终 `done` 包含所有消息；群组消息作者仍是正确角色。
- Fake TTS 能观察到 voice 更新；调用群组通话只占一次 call quota，不产生单角色 activity 行。
- 不存在群组、越权群组、当前成员不足或请求同时包含两个目标时返回清晰的 4xx；单角色通话相关测试继续通过。

## 实现

- `Admissions.group_call` 与 `_GroupCallRecording` 提供不写单角色活动行的 call lease；`Calls.start_group` 复用现有 WebRTC、CallOutcome、并发通话和挂断流程。
- `Call` 的 target 使用 `GroupCallTarget` 联合类型；`GroupCallTurns` 复用 `TurnTaking`，调用 `GroupTurnEngine`，在 speaker 边界 flush segment 并切换 TTS 设置。
- 连接时捕获成员、作者快照和 voice id；群组回合取消时显式关闭模型流并失败回合，避免 `group_turns` 永久保持 running。
- 在 Fake TTS 中记录 voice 变更，增加真实 Browser/aiortc 群组通话测试和越权/成员边界测试。

## 不做

- 不接前端群组拨号、群头像、立绘和导航外壳；不改变单角色 `LiveConversation`/`CallLayer`。
- 不新增 `group_calls` 活动表、统计、成就、记忆或数据包格式；这些归产品收尾票统一定义。
- 不支持多轨音频、并行 TTS、后台主动来电、每角色独立 LLM 或通话中的成员变更。
