# 最小文字界面

Type: task
Status: done

Blocked by: 03

## Acceptance Criteria

- [x] 增加群组 API 类型和 SSE 客户端。
- [x] 对话列表可创建并进入群组。
- [x] 群组页展示成员、历史消息、作者和群头像。
- [x] 选择目标/@、引用消息并发送，SSE speaker/done/error 可见。
- [x] 添加纯函数和组件相关测试，单角色页面行为不变。
- [x] 建立并完成本票独立计划。

## Comments

### 票 04 交接

票 03 已提供用户作用域群组生命周期、消息读取和明确目标 turns SSE；本票只负责前端最小文字界面。

### 实现说明（票 04）

- 在 `api.ts` 增加群组类型、列表/详情/消息/创建请求和 `sendGroupTurn` SSE 客户端，沿用 `turnOwnKeys` 与统一错误处理。
- 对话列表新增独立群组区与 2–5 位选择创建弹窗；群组路由纳入导航外壳，单角色通话逻辑保持不变。
- 新增群组页，支持历史消息、作者头像、引用角色消息、明确目标选择、幂等键发送和 `speaker/done/error` 状态。
- 新增 `groupChat` 纯函数及测试，并覆盖群组 SSE、导航外壳路由行为。
- 验证：`npm test -- --run src/lib/groupChat.test.ts src/lib/api.test.ts src/lib/navShell.test.ts`、`npm run typecheck`、`sh frontend/scripts/check-discipline.sh` 通过。
