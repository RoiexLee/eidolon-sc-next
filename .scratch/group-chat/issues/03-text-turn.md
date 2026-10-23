# 明确目标的文字回合

Type: task
Status: done

Blocked by: 02

## Acceptance Criteria

- [x] 新增群组消息/回合读写及幂等、并发保护。
- [x] 新增 GroupTurnEngine，历史安全分隔且只调用目标角色。
- [x] 新增群组 turns SSE，包含 speaker/done 作者字段。
- [x] 实现 @/回复目标校验和 4xx 错误。
- [x] 一次群组回合使用一次文字限额，P2 不污染单角色 activity。
- [x] 失败不落半条消息，测试覆盖权限、提示词、幂等、并发和失败。
- [x] 建立并完成本票独立计划。

## Comments

### 票 03 交接

票 02 已完成群组表、GroupStore 生命周期和用户隔离。群组通话、主动跟话、前端页面及单角色能力不在本票范围。

### 实现说明（票 03）

- `GroupStore` 增加群组消息/回合读写、幂等键指纹、running 状态保护，以及用户消息和完整角色消息的一次事务提交；失败只更新回合状态，不写孤立消息。
- `GroupTurnEngine` 复用 `TurnLLMs` 与 `ReplyParser`，固定提示带目标角色人设、世界设定和制作人资料；成员规则在 system，群组历史在带作者标签的 user 块中，正文按不可信内容处理。
- `Admissions.group_turn` 只占一次文字 `UsageLimiter`，不创建单角色 activity 记录；群组 API 增加消息读取和 turns SSE，目标、引用、mentions、幂等、并发及成员变更均做服务端校验。
- 流响应在生成器未启动或用户断开时也会释放限额和密钥；用户离开按既有 `left` 语义结算，自带模型错误保留可行动提示，进程重启会回收无法恢复的 running 回合。
- 新增 `test_group_turn.py` 覆盖明确 speaker、作者字段、目标校验、失败回滚后重试、同键并发拒绝和历史提示隔离。

自测：受影响后端测试 176 passed；ruff、pyright、`git diff --check` 通过。`scripts/affected-tests.sh` 在当前 PowerShell 环境找不到 PATH 中的 `uv`，已用等价 `uv run` 命令执行其列出的检查。
