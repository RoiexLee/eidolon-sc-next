# 受控的轮流主动回复

Type: task
Status: done

Blocked by: 04

## Acceptance Criteria

- [x] 无目标群组回合按当前成员顺序确定性选择一位角色。
- [x] 引用作者优先，显式目标与冲突校验保持不变。
- [x] 前端可选择轮流模式并发送空 mentions。
- [x] 添加后端/前端测试，单角色行为不变。
- [x] 建立并完成本票独立计划。

## Comments

### 票 05 交接

票 04 已提供群组列表、消息记录、目标选择和引用发送；本票只增加用户触发的受控轮流 speaker，不生成第二条自动角色消息。

## 实现说明（票 05）

- 后端在群组回合锁内重读当前成员和历史消息，按成员位置轮流选择目标；无历史角色消息从第一位开始，上一位移除后从当前第一位开始。
- 无目标请求的幂等指纹保留请求语义，不记录会随历史变化的目标；引用作者优先，显式目标和冲突校验未改动。
- 前端增加“按顺序轮流”选项，使用非空选择值映射为空 mentions；请求和乐观消息均保持空 mentions。
- 检查：`uv run pytest tests/test_group_turn.py -q`（9 passed）、前端 `npm test -- --run src/lib/groupChat.test.ts src/lib/api.test.ts`（35 passed）、`npm run typecheck`、`sh scripts/check-discipline.sh`、ruff、pyright 均通过。
