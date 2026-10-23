+# 群组对话票 02：数据层与生命周期

Status: done

本票只实现群组对话的持久化和生命周期接口，不调用模型，不实现文字回合、SSE、主动回复或通话。

## 已确认边界

- 群组对话是独立实体，不修改单角色 `Conversation`、`messages`、`Call` 或既有接口。
- 一条群组必须有 2–5 位不同的当前成员，成员有稳定顺序；移除成员保留历史作者快照，且不能让当前成员少于两位。
- 群组只属于创建它的用户；所有读写按 `user_id + group_id` 鉴权。
- 群组头像不落库，由后续前端按当前成员顺序派生。
- 首期数据包、统计、记忆和活动看板不在本票接入。

## 交付物

- 新增 `backend/src/eidolon/group_store.py`，通过现有 `Database` 异步读写：
  - `group_conversations`、`group_members`、`group_messages`、`group_turns` 四张表；
  - 创建、列表、详情、成员增删、硬删除；
  - 软移除成员时保留 `name_snapshot`，禁止当前成员少于两位；
  - 删除群组和删除用户时清理所有群组行。
- 在 `database.py` 的用户/删除清单中注册群组表；由 `assembly.py` 构造并注入 GroupStore。
- 新增 `group_api.py`，注册最小生命周期接口：
  - `POST/GET /api/groups`
  - `GET/PATCH/DELETE /api/groups/{group_id}`
  - 暂不开放 messages/turns。
- 返回当前成员、历史成员快照、群名、最后消息摘要所需的稳定字段；角色不存在、重复成员、越权 group id、移除后少于两位均返回明确的 4xx。
- 新增 Store/API 测试，覆盖旧库建表、权限隔离、2/5 边界、成员软移除、删除用户和删除群组；不修改单角色测试。

## 验收

- 空数据库和旧单角色数据库启动后均能创建群组表。
- 一个用户不能读取或修改另一用户的群组。
- 成员顺序和作者快照可持久化，移除后历史成员仍可读但不是当前目标。
- 删除群组和删除用户不留下群组成员、消息、回合或群组本体。
- 受影响的后端单测、类型检查和 `scripts/affected-tests.sh` 通过。
