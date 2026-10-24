# 群组对话后续修复 22：群聊通话背景
Type: task
Status: done

## Acceptance Criteria
- [x] 无 speaker 时通话背景显示群头像。
- [x] speaker 开始和结束时正确切换角色/群组背景。
- [x] 自定义头像、成员变更和缺失角色资料有安全回退。
- [x] 相关测试和 affected-tests 通过。

## Comments

### 实现说明（票 22）

群聊通话层根据当前 speaker 的背景图/头像显示角色背景；无可用角色图片时渲染铺满的 `GroupAvatar` 作为群组背景。`GroupAvatar` 新增 `backdrop` 尺寸，复用票 20 的自定义头像选择。验证通过前端 typecheck、群聊通话状态测试和 API 测试。
