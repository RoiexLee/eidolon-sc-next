# 群组对话修复 03：列表群头像使用角色缩略图

Status: draft

## 问题

群聊页和通话条使用的 `components/conversations/GroupAvatar.tsx` 已能按角色 id 映射 `Character.avatar_url`，但 `ConversationList.tsx` 里有一份重复的本地 `GroupAvatar`，只渲染成员名字首字。因此对话列表中的群头像与群聊页不一致。

## 目标

- 群组列表头像显示当前成员的角色缩略图拼贴。
- 角色没有缩略图时仍能回退到名字首字。
- 成员顺序、最多展示三位成员和现有群头像圆形裁切保持不变。

## 设计与实现

1. 列表渲染时把导航外壳已经加载的 `characters` 传给共享 `GroupAvatar`，移除 `ConversationList.tsx` 内的重复头像实现。
2. 复用 `GroupAvatar.tsx` 的 `groupAvatarMembers()`、`avatar_url` 映射和回退逻辑；若共享组件缺少列表尺寸，只增加一个语义化的 `list` 尺寸，保持 `bar`、`lg`、`call` 现有外观不变。
3. 头像图片继续作为群组整体标签的装饰内容，保留群组名称的 `aria-label`；不把图片 URL 写入群组数据库或 API。

## 影响范围

- `frontend/src/components/conversations/ConversationList.tsx`
- `frontend/src/components/conversations/GroupAvatar.tsx`
- 必要时新增该组件的渲染测试或扩展 `frontend/src/lib/groupChat.test.ts`
- 不改后端 `GroupMember` 数据结构和头像资源接口

## 验收与测试

- 列表群头像与群聊页、通话条使用相同角色缩略图和成员顺序。
- 缺失图片时显示原有首字回退，不出现破图或空白格。
- 当前成员变化后，列表刷新能显示新成员头像。
- 运行相关 Vitest、`npm run typecheck`、discipline；本地构建版检查亮/暗模式和窄屏列表。

## 不在本票

- 不重新设计群头像布局，不增加用户上传群头像。
- 不改变群聊页已经正确的头像映射逻辑。
