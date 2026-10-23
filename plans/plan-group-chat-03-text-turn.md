+# 群组对话票 03：明确目标的文字回合

Status: done

本票只实现后端群组文字回合：用户指定一位当前成员后，服务端读取群组历史、调用目标角色并通过 SSE 返回。前端页面、主动跟话、群组通话、好感度、记忆、统计和数据包继续后置。

## 依赖与边界

- 依赖票 02 的 GroupStore 和生命周期路由；旧单角色 ConversationEngine、Admissions.turn、单聊 SSE 不改。
- 请求只能命中当前群组成员；reply_to_message_id 只能引用同一群组中当前成员的角色消息；mention_character_ids 首期最多一个，且必须是当前成员。
- 没有唯一目标、目标已移除、跨群引用、引用用户消息或 mentions 冲突时返回 422，不猜测 speaker。
- 一次群组回合只占一次现有文字 UsageLimiter；P2 不写现有 activity_records/rollups，不改变按角色看板。
- 群组上下文只包含该群组成员和最近历史；成员名单/规则在 system 上下文，历史放明确分隔的 user 历史块，正文按不可信内容处理。

## 交付物

- 在 group_store.py 增加群组消息/回合的读取和原子写入：
  - 用户消息与角色消息保存作者种类、角色 id、作者名称快照、引用 id、规范化 mentions；
  - 回合保存客户端幂等键和状态，失败不落角色半条消息；
  - 重试相同幂等键返回已有结果或明确冲突，同一群组同时只允许一个进行中回合。
- 新增 group_engine.py 的最小 GroupTurnEngine：
  - 复用现有 LLM、TurnLLMs、ReplyParser、格式说明和分段事件；
  - 固定提示带目标角色人设/世界设定/制作人资料；动态 system 只带成员名单、目标和安全规则；
  - 最近群组历史作为带作者标签的不可置信 user 块，不得提升为 system 指令；
  - 成功后一次事务写入用户消息和完整角色消息，并返回 author_character_id、turn_id。
- 在 group_api.py 新增 POST /api/groups/{group_id}/turns：
  - 请求支持 text、reply_to_message_id、mention_character_ids、客户端幂等键和 own_keys；
  - SSE 沿用 user/delta/done/error，首个角色 delta 前发送 speaker；
  - 空文本、超长文本、目标和权限错误使用现有 4xx 语义；模型失败不写半条记录。
- 加入后端测试：目标解析/权限、历史提示注入隔离、幂等/并发、失败回滚、SSE speaker/done 字段、一次限额；旧单角色测试不改。

## 验收

- 用 FakeLLM 可完成一条明确目标的群组文字回合，消息历史和作者字段可读。
- @、回复引用、冲突和非当前成员均按契约返回 422。
- 同一群组并发请求最多一个进入模型；失败后可重试且没有孤立角色消息。
- git diff --check、受影响后端测试、pyright/ruff 和 scripts/affected-tests.sh 通过。
