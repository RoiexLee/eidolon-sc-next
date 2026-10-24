# 群组对话后续修复 22：群聊通话背景

Status: done

## 目标

群聊通话在拨号、无当前角色和角色切换间隙默认显示群头像背景；角色开始说话后切换到角色背景，结束后回到群头像背景。

## 设计

- 在 `GroupCallLayer` 复用 `GroupAvatar` 的自定义头像/成员拼贴，生成装饰性背景图层，不新增图片存储。
- 有当前 speaker 时沿用角色 `background_url`/`avatar_url`；没有 speaker 时使用群头像，覆盖层和可读性渐变保持现有通话规范。
- 只改群聊通话视觉适配，不改变单聊 `CallLayer`。

## 验收

- 拨号、空闲 speaker 间隙和 speaker-ended 后都能看到群头像背景。
- speaker-started 后角色背景出现；缺少角色背景时有头像回退。
- 群头像自定义和成员变更在通话层同步。

## 实现结果

- `GroupAvatar` 增加铺满背景尺寸，支持自定义成员头像和拼贴头像统一作为装饰背景。
- 群聊通话无 speaker、speaker 缺少图片和 speaker-ended 间隙显示群头像背景；有角色图片时继续显示角色背景。
- 验证：前端 typecheck、群聊通话状态测试和 API 测试通过。
