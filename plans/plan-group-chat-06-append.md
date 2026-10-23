# 群组对话票 06：一次追加角色回复

Status: done

票 05 已支持用户触发的确定性轮流 speaker。本票让一次群组文字回合在主回复完成后最多追加一位角色的一条回复，作为受控的积极交流；追加不再触发下一轮追加，失败只标记部分完成，不回滚已经完成的主回复。

## 范围

- `GroupTurnEngine` 在主角色消息提交后，按当前成员位置选择下一位角色；显式目标/引用作者仍是主 speaker，追加 speaker 不重复主 speaker。
- 追加角色使用同一群组历史、成员清单和安全边界，单独调用现有 `TurnLLMs`，复用 `ReplyParser`；每个用户回合最多两条角色消息。
- `GroupStore` 增加追加角色消息的独立事务：主消息和用户消息先提交，追加消息成功才写入；追加失败不写半条消息、不重试。
- SSE 保留现有 `speaker/delta`，`done` 增加 `messages` 完整数组并继续兼容单条 `message`；前端在 done 时一次性追加用户消息、主回复和可选追加回复，流式状态仍显示当前 speaker。
- 追加错误使用明确的 `partial` 事件/字段，仅提示主回复已完成；不退款、不把回合标成失败，也不触发第三个 speaker。
- 补充引擎、存储、HTTP 和前端 SSE/消息列表测试；总回合仍只占一次文字限额，单角色页面和 P2/P3a 明确目标行为不变。

## 不做

- 不做角色无限接龙、同时多角色说话、离线主动搭话、推送、每日调度或群组通话。
- 不增加 planner/judge 模型或每角色独立 LLM；追加 speaker 只用确定性成员顺序。
- 不改变好感度、记忆、统计、数据包、成员编辑和单角色通话。

## 验收

- 一次轮流或明确目标用户回合最多生成主 speaker 与一位不同的追加 speaker；重复请求不会生成第三条。
- 主回复成功后追加失败时，主消息保留，SSE 显示部分完成，回合可读且不留下追加半条消息。
- `done.messages` 与现有 `done.message` 均可被前端解析；每条角色消息保留作者、turn id、引用和 mentions。
- 相关后端/前端测试、类型检查、纪律检查和 `scripts/affected-tests.sh fcb420a6` 通过。

## 实现

- `GroupTurnEngine` 复用统一的流式解析器，在主消息事务完成后最多运行一次追加模型；追加目标从当前成员中按最新用户回合的主 speaker 轮换，主角色不会再次被选中，也不会递归追加。
- `GroupStore.append_character_message` 在主回复已写入但仍保持运行中的回合内独立写入一条角色消息，追加完成后才结束回合；追加失败不会写入半条消息，期间成员变更仍被回合锁阻止。
- SSE 的 `done.message` 仍指向主角色消息，同时提供完整的 `messages` 和 `partial`；追加失败发送 `partial` 并保留主回复。完成回合的幂等重放返回完整消息列表且不把旧单回复误报成失败。
- 群组页面按 `done.messages` 一次性加入主回复和追加回复，兼容旧的单条 `message`，并显示追加失败提示；单角色页面与限额入口未改动。

## 检查

- `backend`: `uv run pytest tests/test_group_turn.py -q`（12 passed）；ruff、pyright 通过。
- `frontend`: `npm test -- --run src/lib/api.test.ts src/lib/groupChat.test.ts`（36 passed）、`npm run typecheck`、`sh scripts/check-discipline.sh` 通过。
