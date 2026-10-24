# 群组对话后续修复 23：角色语音切换完整性

Status: draft

## 目标

查明并修复群聊通话中上一位角色语音未播放完就切换到下一位的问题，保证事件、TTS segment 和浏览器播放顺序一致。

## 设计

- 审计 `GroupCallTurns` 的 speaker 边界、`SegmentCompleteFrame`、TTS voice 更新和 WebRTC 输出队列的时序。
- 在可验证的边界等待当前 speaker 的最后一个 segment 完成后再发送下一位的 `speaker-started` 和 voice 更新；必要时用现有 Pipecat frame seam，不新增并行播放管线。
- 前端只接受当前回合、成员快照内且顺序有效的 speaker 事件；迟到事件不得覆盖当前 speaker。
- 增加 Fake TTS/浏览器测试，断言上一位的 segment 完成事件先于下一位的 voice 更新和 speaker-started，并覆盖取消、挂断和多回合。

## 验收

- 每位 speaker 的 `speaker-started`、segment 完成、`speaker-ended` 严格成对串行。
- 下一位开始前上一位所有已生成音频已 flush；取消时不遗留 running 回合。
- 单角色通话和群聊文字回合不回归。
