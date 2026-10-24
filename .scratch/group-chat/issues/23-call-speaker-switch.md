# 群组对话后续修复 23：角色语音切换完整性
Type: task
Status: ready-for-agent

## Acceptance Criteria
- [ ] 下一位 speaker 开始前上一位 speaker 的 TTS segment 已完成并 flush。
- [ ] 事件顺序和浏览器可观察到的播放顺序有测试覆盖。
- [ ] 取消、挂断和多回合不遗留错误 speaker 或 running 回合。
- [ ] 单角色通话回归通过。

## Comments

### 实现说明（票 23）

待实现。
