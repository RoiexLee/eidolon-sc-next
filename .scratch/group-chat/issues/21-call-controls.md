# 群组对话后续修复 21：群聊通话控件与用户字幕
Type: task
Status: done

## Acceptance Criteria
- [x] 静音按钮有私人通话同样的按下视觉和无障碍状态。
- [x] 群聊通话始终显示用户输入/识别文本，不依赖角色台词已出现。
- [x] 相关测试和 affected-tests 通过。

## Comments

### 实现说明（票 21）

`GroupCallLayer` 的静音键补齐 `aria-pressed`，使 `call-round` 现有按下态生效；台词卡改为在 `line`、`hearing` 或 `typed` 任一存在时渲染，并在没有角色台词时显示用户文本/提示。验证通过 typecheck 和群聊通话状态测试。
