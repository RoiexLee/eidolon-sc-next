# 群组对话票 09：前端群组通话与导航外壳接入

Status: done

本票只把票 08 已完成的后端群组通话接入浏览器前端。用户可以从群组页拨号，拨号和没有角色发言时看到群头像；收到 `speaker-started` 后切换到对应角色的头像、颜色、字幕和可用立绘；`speaker-ended` 后回到群头像。通话由导航外壳持有，换到设置、玩法或其他允许保留通话的页面时不断线。

本票不改后端协议、不把群组伪装成单角色对话，也不复制单角色的好感度、礼物、照片、结束卡或活动记录语义。

## 对原始设想的收敛

- “切换到角色的模型”在现有系统里应实现为切换角色的音色和视觉资料（头像、印象色、立绘）；LLM 仍是部署级配置，不在本票增加每角色独立模型。
- 群组通话仍是一条音频轨道。角色按后端 speaker 事件串行发声，浏览器不并行播放，也不自行猜测当前角色。
- 群组角色的“积极主动”不在通话前端扩展为离线来电或无限接龙；前端只展示后端已经产生的主回复和有限追加回复。
- 群组通话首版不显示单角色专属的好感度、礼物、照片和单角色结束卡，避免把一条群组消息记到某个角色的单聊记录。

## 目标与不变量

1. 单角色通话的请求、事件、视觉和回归测试保持原语义。
2. 通话目标必须显式区分单角色和群组，不能把 `group_id` 塞进 `conversation_id`。
3. 群组通话收到迟到或重复的 speaker 事件时，不得把已经结束的角色重新显示为当前 speaker。
4. 群组会话独立保存群组消息、当前 speaker、流式字幕和通话阶段；不得把 `GroupMessage` 喂给单角色 `LiveConversation` 的记录、好感度或奖励处理。
5. 群组成员缺少当前角色配置时仍可显示历史作者和群头像；通话层不能因为头像、颜色或立绘缺失而崩溃。
6. 页面导航只改变通话层的显示位置，不改变 WebRTC 连接、麦克风、通话阶段或 speaker 快照。

## 方案

### 1. 通话目标和事件类型

在 `frontend/src/lib/call.ts` 定义显式目标联合类型：

```ts
type CallTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "group"; groupId: string };
```

`startCall` 和 `getCallSetup` 接收 `CallTarget`。单角色请求继续发送 `conversation_id`，群组请求只发送 `group_id`；`/api/ice-servers` 查询参数和 `/api/offer` 请求体保持相同的互斥规则。所有单角色调用点迁移到 `kind: "conversation"`，不保留容易把群组 id 当角色会话 id 的字符串重载。

在 `frontend/src/lib/api.ts` 扩展 `CallEvent`：

- `speaker-started`：`speaker_id`、`speaker_name`；
- `speaker-ended`：`speaker_id`；
- 群组 `done`：保留 `turn_id`、`reply`、`partial`，并明确携带 `messages: GroupMessage[]`（`message` 仅作兼容首条消息，不参与单聊处理）。

文字群组的 `speaker` 事件和通话的 `speaker-started/ended` 分开建模，避免两套协议因为同名语义混用。

### 2. 独立群组通话会话

新增 `frontend/src/lib/liveGroupConversation.ts`，只负责群组通话实时状态和生命周期：

- 目标：`{ kind: "group"; groupId }`；
- 群组标题、成员快照和成员角色映射；
- `phase`、收起/展开状态、拨号失败/被动结束状态；
- `speakerId`、`speakerName`，以及当前回合按 segment 累积的日中字幕；
- 通话收到的群组 `messages`，用于结束后在当前页追加显示或刷新历史；
- 麦克风、输入文字、只看文字、挂断、离开和迟到事件 gate。

它复用 `call.ts` 的 Call 接口和现有的铃声/计时/麦克风状态机，但不复用 `LiveConversation` 的 `ConversationLog`、affinity、photo、gift、achievement、single-character stand 或 single-character end card。`dispose`、`failed`、`dropped` 和 `ended` 必须清空当前 speaker，释放事件订阅，丢弃后续事件。

### 3. 群组视觉呈现

新增可复用的 `GroupAvatar`（或从现有群组列表头像抽出同一组件），成员按稳定顺序派生拼贴头像；没有可用角色资料时退回群组标题 initials。群头像不保存图片、不新增固定颜色。

把通话层的“显示对象”从单纯的 `Character` 扩为一个小型视觉联合类型：

- `character`：现有单角色头像、背景、印象色、立绘；
- `group`：群标题、群头像、成员映射和中性通话背景；
- `group + activeSpeaker`：在群组视觉上覆盖当前 speaker 的角色资料。

`CallLayer`、`CallBar` 和外壳持有层只消费这个显示对象，不在组件内部到处添加 `character | group` 条件。群组无 speaker、speaker 切换间隙和 speaker-ended 后使用群头像；speaker-started 后使用成员映射到的角色头像、名字和颜色。角色没有 stand 或背景时使用已有中性回退，不影响音频和字幕。

群组通话不渲染单角色的 affinity cue、礼物入口、照片卡和单聊结束记录；保留通话中用户输入、字幕、静音/换麦、挂断与失败重试等通用操作。

### 4. Directory、NavShell 和路由

在 `frontend/src/components/conversations/ConversationDirectory.tsx` 引入 session union：

```ts
type HeldCall = LiveConversation | LiveGroupConversation;
type CallTargetRef =
  | { kind: "conversation"; characterId: string; conversationId: string }
  | { kind: "group"; groupId: string; title: string | null };
```

增加 `openGroup(groupId, userId)`，由群组页调用；Directory 仍只持有一通通话。`close`、`hangUp`、`held`、`isHeldShown` 和 CallBar 元数据改为按 target union 工作。单角色 `open`、测试 fake ports 和已有导航行为继续可用。

`NavShell` 根据 held session 的 kind 选择单角色或群组视觉对象，群组 session 不再要求能找到一个假的 `characterId`。`CallBar` 显示群组标题和群头像。`navShell.ts` 的规则改为比较结构化 target：

- 同一群组页：允许显示该页的通话层，不额外显示 shell bar；
- 设置、玩法、对话列表和其他 shell 页面：保留通话，显示 shell bar；
- 进入另一群组页、另一角色对话页或离开 shell：沿用 ADR-0018 的确认/挂断规则；
- group 路由不能通过 `conversationOf` 被误解析成名为 `group` 的角色。

群组页 `GroupConversationView` 的顶部加入通话入口，调用 Directory 的 `openGroup`，不在页面内部直接调用 `startCall`。页面卸载后由 shell 继续持有 session；回到群组页时使用同一份实时状态。

### 5. 事件和消息处理

- `speaker-started`：校验 speaker 在通话开始时的成员快照中，切换当前视觉对象并清空新的 speaker 的 segment 缓冲。
- `delta`：只写入群组 session 的流式字幕。后端的群组通话事件中，追加 speaker 仍可能沿用同一个 `reply` 编号，而每个 speaker 的 segment 又从 0 开始；因此 session 在每次 `speaker-started` 时生成内部 speaker-reply 序号，用“内部 speaker-reply + segment”合并，不能直接把单角色的 `reply`/`segment` 当作全局键。
- `speaker-ended`：只有事件中的 id 与当前 speaker 相同才清空当前 speaker；旧 speaker 的迟到 ended 不得清掉新 speaker。
- `done`：以 `messages` 一次性追加群组消息并结束本回合；不调用单角色 `applyTurnEvent`。
- `error`、`ended`、`dropped`、挂断和取消：清空 speaker、保留可读错误状态，关闭后续事件入口。

同一通话的音频仍由 `Call` 的单条 track 提供，前端不按 speaker 重建连接或创建多个音频元素。

## 修改范围

### 需要修改

- `frontend/src/lib/call.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/liveGroupConversation.ts`（新增）
- `frontend/src/components/conversations/ConversationDirectory.tsx`
- `frontend/src/lib/navShell.ts`
- `frontend/src/components/app/NavShell.tsx`
- `frontend/src/components/conversations/CallBar.tsx`
- `frontend/src/components/conversations/CallLayer.tsx`
- `frontend/src/components/conversations/GroupConversationView.tsx`
- 群头像共享组件所在的 `frontend/src/components/conversations/` 或 `components/app/`
- `frontend/src/i18n/zh.ts` 中必要的群组通话文案

### 测试和文档

- `frontend/src/lib/api.test.ts`：group ICE 查询、offer 请求体和 group done/speaker 解析；
- `frontend/src/lib/call.test.ts`：group target、own keys 删除、单角色回归；
- 新增 `frontend/src/lib/liveGroupConversation.test.ts`：speaker 顺序、迟到 ended、done.messages、失败/取消/dispose；
- `frontend/src/lib/navShell.test.ts`：同组、其他组、单角色、离开 shell 的保留与挂断规则；
- 更新相关 fake ports/fixtures，保持 `liveConversation.test.ts` 全部通过；
- 如通用 CallLayer 需要新的可访问名称，只加入 `frontend/src/i18n/zh.ts`，不在组件内写临时中文。

## 实现顺序

1. 先读现有 Next/React 组件约定和 call/navShell 测试，建立目标和事件类型，先跑 TypeScript 让所有单角色调用点显式迁移。
2. 实现 `startCall`/`getCallSetup` 的 target union 和 API 事件类型，补 request body/query 测试。
3. 实现 `LiveGroupConversation` 及其纯状态测试，确保 speaker gate 和终态清理独立于 React。
4. 抽出群头像和 call presentation，扩展 `CallBar`/`CallLayer`；保持单角色视觉快照不变。
5. 扩展 Directory/NavShell/navShell 规则，把 group session 接入 shell 持有。
6. 在 `GroupConversationView` 接入拨号入口和返回页后的同一 session。
7. 跑前端类型检查、受影响的 Vitest、discipline 检查；提交前按实现规范运行 `sh scripts/affected-tests.sh <票 09 开工基点>`。
8. 用本地构建版 Playwright 验收：群组页拨号、无 speaker 群头像、speaker 切换、换页不断线、返回群组页、失败/挂断清理；临时验收脚本和截图不提交。

## 验收标准

- [x] 单角色 `/api/ice-servers`、`/api/offer` 请求字段和现有通话测试不回归。
- [x] 群组请求只带 `group_id`，群组 ICE/offer 失败时显示后端错误且不残留通话层。
- [x] 群组拨号、无 speaker 和 speaker 间隙显示派生群头像；speaker 开始后显示正确角色头像、名字、颜色和可用立绘。
- [x] `speaker-ended` 只清理对应的当前 speaker；迟到事件不会覆盖新 speaker。
- [x] group `done.messages` 显示所有完成消息，并且不写入单角色记录、好感度、照片、礼物或活动状态。
- [x] 群组通话在设置、玩法和列表页之间换页不断线；回到同一群组页继续显示同一通话；进入另一群组/角色或离开 shell 按 ADR-0018 处理。
- [x] 挂断、被动结束、拨号失败、麦克风丢失和 `dispose` 都清理 speaker、音频订阅和 UI 状态。
- [x] 前端类型检查、相关单测、discipline 检查和 affected-tests 通过；已知仓库既有失败在票的评论中注明。

## 不在本票

- 不新增后端 speaker 事件或 TTS 协议；票 08 已完成。
- 不做群组离线主动来电、推送、多人并行音频、独立 LLM 或跨标签页共享。
- 不把群组通话接入单角色好感度、礼物、照片、记忆、成就、统计或数据包；这些需要单独定义 scope 的后续票。
- 不重写单角色 `LiveConversation`；只有通话外壳和明确的共享 display seam 可以抽取。

## 已知风险与回滚

- `CallLayer` 当前深绑 `Character`，抽取显示对象时容易把单角色分支改坏；实现时先保留单角色 adapter，再接群组 adapter，并用现有 `liveConversation` 测试守住回归。
- 群组成员是通话开始时快照，成员在通话期间的增删不应改当前 speaker 映射；回到页面时优先显示快照作者，缺失角色资料使用群头像/文本名称回退。
- 若通用 shell 改造超出本票可控范围，应先提交目标联合类型、群组 session 和 API 接缝，再把视觉壳或导航规则拆成下一票；不得通过伪造单角色会话上线。

## 实现结果

- 已完成显式通话目标、群组事件类型、独立 `LiveGroupConversation`、群头像、群组通话层以及 `ConversationDirectory`/`NavShell` 的持有接入。
- 群组通话复用现有单轨音频、铃声、麦克风和外壳生命周期；speaker 事件只在成员快照内生效，迟到或重复 speaker 不会覆盖当前角色。
- 群组页、外壳通话条和通话层均支持群头像；有角色资料时显示头像，speaker 活跃时切换角色颜色、背景和立绘；缺资料时保持中性回退。
- 验证通过：前端全量 Vitest 79 个文件/1172 个测试、`npm run typecheck`、`sh scripts/check-discipline.sh`、`sh scripts/affected-tests.sh cc283f19`。
- `npm run build` 已完成编译、类型检查和静态生成，但在 Next.js 已知安全漏洞的构建终止检查处退出；未在本票升级依赖。
