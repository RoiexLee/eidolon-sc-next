# 群组对话修复 04：让群聊消息区与私人对话同宽

Status: done

## 问题

`GroupConversationView` 在消息区外包了 `mx-auto max-w-2xl`，把整个群消息列限制在较窄的中央区域；私人对话使用 `MessageScroller` 铺满对话栏，只限制单条气泡宽度。因此群聊两侧留白和私人对话不一致。

## 目标

- 群组页的页首、消息滚动区和输入栏填满与私人对话相同的右侧对话栏。
- 保留单条角色气泡和用户气泡的最大宽度，避免长文本横跨整屏。
- 不改变消息顺序、滚动到底、引用、流式回复和通话层覆盖关系。

## 设计与实现

1. 参考 `ConversationView.tsx` 的 `MessageScrollerProvider`、`MessageScroller`、`MessageScrollerViewport` 和 `MessageScrollerContent` 结构，替换群聊消息区外层的固定 `max-w-2xl` 容器，或至少让该容器成为全宽滚动内容。
2. 保留 `GroupMessageBubble`/`StreamingCharacterBubble` 上的单条气泡 `max-w`；消息区使用与私人对话一致的横向内边距、纵向间距和最小宽度规则。
3. 在宽屏和窄屏都以对话栏实际宽度为基准，不给群聊单独设置页面级宽度；通话条、通话层和返回键行为不改。

## 影响范围

- `frontend/src/components/conversations/GroupConversationView.tsx`
- 必要时复用现有 `frontend/src/components/ui/message-scroller.tsx`
- 不改导航外壳的 `ResizablePanel` 和私人 `ConversationView`

## 验收与测试

- 群聊页消息区左右边界与同一窗口下私人对话一致。
- 长消息仍只扩展单条气泡，不造成横向滚动。
- 空状态、历史消息、流式回复、引用和群组通话收起条仍正常。
- 运行 typecheck、discipline 和相关前端测试；本地构建版 Playwright 至少比较宽屏、窄屏和调整列表栏宽度后的布局。

## 不在本票

- 不调整气泡视觉样式、头像大小或输入栏功能。
- 不把群聊消息改造成私人消息的数据结构。

## 实现结果

移除群聊消息列外层的 `max-w-2xl` 限制，消息区现在沿用对话栏的完整宽度；单条消息气泡仍保留原有最大宽度，输入栏和通话层不变。

## 验证结果

已通过前端 typecheck、discipline 检查和受影响测试。
