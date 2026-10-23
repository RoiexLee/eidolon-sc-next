+# 数据层与生命周期

Type: task
Status: done

Blocked by: 01

## Acceptance Criteria

- [x] 新增四张群组表和异步 GroupStore。
- [x] 群组创建、列表、详情、成员增删、硬删除具备用户隔离。
- [x] 当前成员保持 2–5 位，移除保留历史作者快照。
- [x] 账号删除和群组删除清理所有群组数据。
- [x] 新增生命周期接口，不开放消息/回合接口。
- [x] 新增 Store/API 测试，旧单角色测试不变。
- [x] 建立并完成本票独立计划。

## Comments

### 票 02 交接

票 01 已完成术语与 ADR-0029。实现应保持单角色 `Conversation`、`Call` 和既有路由不变。

### 实现说明（票 02）

新增 `group_store.py`，以四张独立表持久化群组、成员、消息和回合；成员移除写入 `removed_at`，保留 `name_snapshot`，并在写事务中校验当前成员数为 2–5。`database.py` 的用户删除和群组删除清单覆盖四张表，`assembly.py` 注入 `GroupStore`。新增 `group_api.py` 并注册创建、列表、详情、成员/名称更新和硬删除接口；消息与回合路由留给后续票。所有查询和写入带 `user_id` 约束。

### 自测

- `uv run --directory backend ruff check src/eidolon/group_store.py src/eidolon/group_api.py src/eidolon/database.py src/eidolon/assembly.py src/eidolon/app.py`：通过。
- `uv run --directory backend pyright src/eidolon/group_store.py src/eidolon/group_api.py src/eidolon/assembly.py src/eidolon/app.py`：通过。
- `uv run --directory backend pytest -q tests/test_group_store_api.py`：3 passed。
- `uv run --directory backend pytest -q tests/test_assembly.py tests/test_database.py tests/test_delete_account.py`：23 passed。
- `git diff --check`：通过。

### 审查修复

- Standards 审查指出 `add`/`remove` 别名属于未要求的契约；已删除，只保留 `add_character_ids`/`remove_character_ids`。
- Spec 审查指出标题清空、旧库建表、API 数量边界和重新加入成员的历史保留缺口；已补充显式 `title: null` 处理、旧单聊库测试、API 边界测试，并让重新加入插入新成员行而保留旧移除记录。
