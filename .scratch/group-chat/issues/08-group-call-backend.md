# 后端群组通话纵切

Type: task
Status: done

Blocked by: 07

## Acceptance Criteria

- [x] `group_id` 与 `conversation_id` 互斥，ICE/offer 都检查群组所有权和当前成员边界。
- [x] 群组通话使用独立 call admission，占用一次通话限额且不写单角色 activity 记录。
- [x] 真实 WebRTC 回合发送成对的 speaker 事件，消息持久化为正确作者，并在 speaker 之间串行切换 TTS voice。
- [x] 群组通话取消不会留下永久 running 的群组回合；单角色通话接口和测试不回归。
- [x] 建立并完成本票独立计划。

## Comments

### 实现说明（票 08）

- `CallRequest` 新增互斥 `group_id`，`Calls.start_group` 在接通时保存 `GroupCallTarget` 成员/音色快照；`GroupCallTurns` 复用 `GroupTurnEngine` 并通过 `TTSUpdateSettingsFrame` 切换 Fish Audio voice。
- `Admissions.group_call` 只拿 call usage lease，不创建以群组 id 冒充角色的 activity row；群组结束继续由 `CallOutcome` 处理限额和释放。
- 真实 Browser 测试覆盖主 speaker、一次追加 speaker、voice 变更、作者持久化和越权/成员边界。

### 票 08 交接

- 下一票接入前端 `call.ts`/`LiveConversation`/`CallLayer` 的 group target union：拨号无 speaker 时显示群头像，收到 speaker 事件后切换角色头像、颜色、字幕和立绘，并按 ADR-0018 保持换页不断线。
- `activity_records`、统计、数据包和群组通话历史仍没有统一 scope；在产品收尾票定义后再接入，不要把当前 no-op recording 当成长期格式。

### 复核修正

- Standards/Spec 复核发现重复测试、ICE 预检漏检下线角色，以及回合异常、成员快照和 segment 边界问题；已删除重复 happy-path 测试，并统一群组通话边界校验。
- 群组通话的历史读取、回合创建和模型流异常现在都会发送终态错误并失败 running 回合；回合创建用 shield 等待数据库写入，取消不会遗留 running 状态。
- 追加回复固定使用通话开始时的成员快照；同一角色切换 segment 前先 flush，避免 TTS 合并相邻段。
