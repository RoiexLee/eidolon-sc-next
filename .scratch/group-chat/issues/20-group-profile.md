# 群组对话后续修复 20：群组资料编辑
Type: task
Status: done

## Acceptance Criteria
- [x] 群组页可编辑名称和头像角色，入口在成员图标右侧。
- [x] 当前成员之外的头像选择被拒绝，移除成员时头像引用安全清除。
- [x] 列表、群聊页、通话条、通话层和数据包保留同一头像语义。
- [x] 相关测试和 affected-tests 通过。

## Comments

### 实现说明（票 20）

新增 `avatar_character_id` 字段和迁移，PATCH 校验当前成员并在移除时清空；前端增加 `GroupEditDialog`，`GroupAvatar` 统一显示自定义成员头像或默认拼贴；数据包往返保留该字段。验证通过 `tests/test_group_store_api.py`、`tests/test_data_package_groups.py`、前端 typecheck、`api.test.ts` 和 `groupChat.test.ts`。
