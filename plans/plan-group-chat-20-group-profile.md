# 群组对话后续修复 20：群组资料编辑

Status: draft

## 目标

在群聊页右上角成员按钮右侧增加编辑图标，打开弹窗修改群组名称，并从当前成员角色头像中选择一张作为群组头像；未选择时继续使用成员拼贴头像。

## 设计

- `GroupConversation`、后端 `GroupConversation`/`GroupPackage` 增加可选 `avatar_character_id`。
- `PATCH /api/groups/{id}` 接受 `avatar_character_id`，只允许当前成员或 `null`，并在成员移除时自动清除非法选择。
- SQLite 通过现有 `_open` 迁移补列；数据包 v3 同步导出/导入，旧包缺字段按 `null` 读取。
- 新增 `GroupEditDialog`，复用现有 Dialog/Button/MarkedAvatar；保存标题和头像选择，错误留在弹窗内。
- `GroupAvatar` 在有自定义头像时显示该角色头像，否则保持拼贴；群聊页、列表、通话条和通话背景统一消费同一字段。

## 验收

- 保存名称和头像后刷新群聊页、列表、通话条仍保持；清除头像恢复拼贴。
- 非当前成员头像被 API 拒绝；成员移除不会留下不可显示的头像引用。
- v3 数据包往返保留头像，旧包导入不报错。
- 相关后端、前端类型和 API 测试通过。
