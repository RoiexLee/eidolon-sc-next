# 群组对话后续修复 23：角色语音切换完整性
Type: task
Status: done

## Acceptance Criteria
- [x] 下一位 speaker 开始前上一位 speaker 的 TTS segment 已完成并 flush。
- [x] 事件顺序和浏览器可观察到的播放顺序有测试覆盖。
- [x] 取消、挂断和多回合不遗留错误 speaker 或 running 回合。
- [x] 单角色通话回归通过。

## Comments

### 实现说明（票 23）

已实现：群聊通话切换前 flush segment，并等待 Pipecat 输出传输层的 `BotStoppedSpeakingFrame` 后才发出下一位角色的切换事件。取消会打断等待，异常或无停止帧时使用既有 TTS 完成超时作为兜底。测试使用非静音 Fake TTS 音频验证实际停止事件先于下一次 voice 更新；文字模式保持无音频等待。
