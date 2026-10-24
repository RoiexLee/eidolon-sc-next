# 计划：Eidolon-PJSK——《世界计划：缤纷舞台》版改造

Status: draft（待 review agent 审阅）
分支：`feat/pjsk`（worktree `D:\project\eidolon-sc-next-worktrees\feat-pjsk`，基点 `3602e8d7` = origin/main，2026-10-23）
调研依据：本次会话的 Live2D 调研报告与仓库策略分析（结论已吸收进「架构决策」）

## 1. 背景与目标

把本系统从《偶像大师 闪耀色彩》单作品系统改造成「一个代码库 + 内容包」的多作品系统，并以《世界计划 缤纷舞台 feat. 初音未来》（下称 PJSK）作为第一个新作品落地：约 26 位角色（5 个团体 + 虚拟歌手）可对话，立绘从原作 Spine 素材换成游戏 Live2D（Cubism 4, moc3）模型，经社区提取后在网页渲染。

**非目标（本期不做）：**

- 不把 SC 立绘迁到 Live2D：SC 部署行为与基点完全一致（零回归是硬约束）。
- 不做单部署多作品共存：一个部署一个作品，由 `EIDOLON_CHARACTERS_PATH` 指向的内容包决定。
- 不改数据包（data package）语义：换作品后角色 id 不互通，旧数据包不导入新作品部署（接受）。
- 不做 PJSK 剧情库全量入库：本期打通同步链路并入库最小集，内容填充后续排票。

## 2. 架构决策（调研已确认，ADR 化见阶段 0）

- **D1 一个代码库 + 内容包**：不 fork 代码链。作品的差异（角色、人设、资料、读音表、世界设定、提示词文本、落地页主题、立绘素材）收进内容包目录；引擎能力（对话、通话、记忆、好感度、群聊、数据包）保持共享。上游（Sallyn0225/eidolon-sc，活跃，日均可观提交）只合并一次。
- **D2 立绘引擎接口化，由内容声明格式**：从现有 `StandEngine` 提取接口（`load/direct/setStill/setPaused/framing/dispose`）；`characters.toml` 每角色新增 `stand_format`（`spine-3.6`（缺省）| `live2d-cubism4`），后端加载配置时校验并随 API 下发；前端唯一分发点 `createStandEngine` 按格式懒加载对应 runtime。不用全局环境变量开关（避免与桶内容脱节的第二事实来源）。
- **D3 Live2D 选型**：`pixi-live2d-display` 方向正确，但不裸用停更的上游（npm 0.4.0，2020 末；仅 PixiJS 6/7）。首选 **Sekai-World 分支**（sekai.best 生产环境渲染 PJSK 模型的同款，含音频口型；另有 `@sekai-world/pixi-live2d-display-mulmotion` 多动作支持），备选 **RaSan147/pixi-live2d-display-lipsyncpatch**（最活跃通用分支，2025-06 仍在发版）。锁 **PixiJS 7**（成熟分支均不支持 v8）。现有 `three` 仅落地页特效用，无冲突。
- **D4 Cubism Core 托管**：`live2dcubismcore.min.js` 专有、不可随仓库再分发。注意 CSP（`contentSecurityPolicy.ts`，ADR-0017）的 `script-src` 只有 `'self' 'unsafe-inline'`，素材桶 origin 只进 img/media/connect 三条——**Core 不能从桶以 `<script>` 加载**（桶不是本站源）。做法：部署者从 Live2D 官网下载后投喂到**站点自身源**：开发期放 `frontend/public/vendor/live2d/`（进 `.gitignore`），生产期由 docker 构建注入或 volume 挂载；不进 git 仓库，也不为此给桶 origin 打开 `script-src`（那会破坏 ADR-0017「只有本站脚本运行」的承诺）。页面 `<script>` 懒加载，模式照抄 `spineRuntime.ts`。
- **D5 许可证姿态**：沿用 ADR-0003/0009/0011 的既有立场（原作素材未经授权、不进仓库、部署者提供）；新增 Live2D 层的说明（镜像 ADR-0009）：`LICENSING.md` 增补 AGPL §7 附加许可；Cubism SDK 出版许可——固定模型、用户不可自带模型，不属于「可扩展性应用」，年营收 <1000 万日元的小规模发行者可免除，部署者自行确认。
- **D6 口型升级**：SC 现状是开/闭嘴两态（冻结帧）。Live2D 最小实现沿用 `StandDirection.speaking` 两态驱动 `ParamMouthOpenY`；增强实现用 WebAudio 振幅驱动（lipsyncpatch 自带能力），提升为连续口型。
- **D7 情绪映射外置**：7 情绪（平静/开心/害羞/惊讶/难过/生气/思考）协议不变；Live2D 的「情绪→表情/动作/参数」映射表按模型 id 放进 PJSK 内容包，模型缺表情文件时用 Cubism 参数合成兜底。

## 3. 分阶段计划

### 阶段 0：决策落地与素材验证（无产品代码）

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P01 | ADR-0029「多作品支持：内容包与作品适配器」（D1、D2 的配置面） | ADR 合并 |
| P02 | ADR-0030「立绘引擎接口与 Live2D 渲染选型」（D2、D3、D6、D7） | ADR 合并 |
| P03 | ADR-0031「Live2D Cubism 许可证与组合分发」（D4、D5）+ `LICENSING.md` §7 附加许可增补 | ADR + LICENSING.md 合并 |
| P04 | spike（Type: research）：PJSK 模型素材源验证——不进仓库、不进桶正式区，本地取得一位角色的 moc3 + model3.json + 贴图/物理/动作/表情清单，记录完整性、体积、moc3 版本；一并实测备选分支（lipsyncpatch）的口型与多动作能力差异；产出素材清单格式草案与 pjsk 版 `stand-sync` 步骤草稿，写入 `.scratch/pjsk/` | spike 报告 + 素材清单格式草案 |

### 阶段 1：立绘引擎接口化（SC 零回归）

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P05 | 提取 `StandEngine` 接口；现有实现改名 `SpineStandEngine`；**建 spine-only 的 `createStandEngine` 工厂**（P06 再扩 live2d 分支）；`Stand.tsx` 与缩略图脚本 `frontend/scripts/stand-thumbnails.mts`（无打包环境现场转译引擎文件，改名即编译失败，必须同票改走工厂）改经工厂。落地页 `StandSlot.tsx` 不构造引擎、不在改动面。只抽接口不改行为 | 现有测试绿；缩略图可产出；SC 通话 Playwright 对拍一致 |
| P06 | 工厂扩展 live2d 分支（runtime 占位）；`stand_format`（缺省 `spine-3.6`）的解析与校验落 **`backend/src/eidolon/characters.py`**（`default_outfit` 的正则校验是先例；`config.py` 只负责 `EIDOLON_CHARACTERS_PATH`），随角色 API 下发（`Outfit` 类型在 `frontend/src/lib/api.ts`） | 无该字段的旧 `characters.toml` 照常工作；配置期校验有测试 |
| P07 | 回归收尾：落地页 `StandSlot.tsx` 确认走工厂路径（`npm run stand:thumbnails` 已在 P05 改造）；`standAnimations.test.ts` 归位为 Spine picker 测试 | 缩略图/落地页与基点对拍一致 |

### 阶段 2：作品适配器（内容层收拢）

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P08 | 后端「作品适配器」入口：`live_sync.py`、`setlist_sync.py`、`world_sync.py`、`mirror.py` 等 SC 专属同步模块收拢注册；端到端验证 `EIDOLON_CHARACTERS_PATH` 指向另一目录可用 | 适配器入口可用、旧路径全部经注册（IP 收窄 grep 的验收在 P09，见 §4 顺序） |
| P09 | 提示词与 IP 文案外移（**以 grep 实测为准**，下列为已核实的命中面）：提示词类 `emotion.py`、`producer.py`、`affinity_judge.py`、`titles.py`、`memory.py`、`photo_judge.py`、`retrieval.py`；前端 `frontend/src/i18n/zh.ts`（唯一 i18n 文件，落地页标题/简介/组合名如 `283プロ` 等**整体外移**，非抽查）、落地页 `light.ts`/`memoryDressing.ts`/`memoryLayer.ts`/`fonts/fontText.ts`。`hot_words.py`/`readings.py` 的专名只在 docstring 示例（代码本身通用，默认读音本就在内容包的 `readings.toml`），列为可选 docstring 清理 | 后端 grep（词边界，见 §7.3）仅剩适配器与注释；SC 部署回归对拍通过 |

### 阶段 3：Live2D 引擎（PJSK 立绘）

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P10 | Live2D runtime 加载器：Core（桶内自托管）+ pixi-live2d-display 分支（npm）；CSP 验证（P04 的分支决策在此落定：Sekai-World vs lipsyncpatch） | 页面只加载所需 runtime；CSP 单测 |
| P11 | `Live2DStandEngine` 骨架：model3.json 载入、取景（knees/waist/full 按模型 bounds 重算）、帧门/像素比/暂停语义复用 `FrameGate` | 一位模型在通话层正确显示与取景 |
| P12 | Live2D picker：情绪→表情/动作/参数映射（映射表随内容包）；点头/视线语义对齐 `StandDirection` | 7 情绪矩阵截图（缩略图脚本扩展）供人工核对 |
| P13 | 口型：最小=两态驱动 `ParamMouthOpenY`；增强=WebAudio 振幅驱动；与段/speaking 语义对齐 | 说话时口型随声音；`只看文字` 时不动 |
| P14 | 群组通话按 speaker 切换立绘/头像兼容（**依赖 feat/group-chat 合入 main**，见 §5） | 群组通话中切换说话人立绘正确 |

### 阶段 4：PJSK 内容包 v1

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P15 | `characters-pjsk/` 骨架：`characters.toml`（26 人、5 团 + 虚拟歌手、`stand_format = "live2d-cubism4"`）、`world.json`（团体/成员）、`readings.toml`（专有名词读音）、人设初稿（后台模型生成 + 人工校对流程，照人设条目约定） | 文字对话全链路（不依赖立绘）可玩 |
| P16 | 剧情同步适配器：日文源 `Sekai-World/sekai-master-db-diff`；中文翻译源选型后接入（选定记录进 `.scratch/pjsk/`）；剧情目录结构对齐 PJSK 的主线/团体/活动/卡面分类 | 最小集剧情入库，角色可回忆自己出场的剧情 |
| P17 | 音色配置与招呼流程：Fish Audio 声线申请/登记流程文档化；招呼（Greeting）与开场白素材管线 | 落地页招呼可播放 |

### 阶段 5：端到端验收与文档

| 票 | 内容 | 产出/验收 |
|---|---|---|
| P18 | 文档：配置指南/部署指南增「多作品」章节（内容包、`stand_format`、Cubism Core 投喂方式）；`GLOSSARY.md` **全文过一遍**：不止「作品」「立绘」——「角色」（283 事务所、はづき）、「组合」（illumination STARS 等八团）等条目同样 SC 专属，逐条泛化或注明「以 SC 部署为例」；首段「本系统只服务一个作品」同步修订 | 文档合并 |
| P19 | 本地验收（照 `docs/agents/local-acceptance.md`）+ 人工验证清单；CI 绿后列正式验证项 | 验收清单全过 |

## 4. 明确的顺序依赖

- P04 → P10（分支选型要 spike 结论）；P05 → P06 → P07/P10；P08/P09 可与阶段 1 并行，**验收顺序 P09 → P08**（P08 完成时 IP 收窄 grep 还不会绿，绿不绿看 P09）；P11 → P12 → P13；P15 不依赖立绘（可与阶段 3 并行）；P14 依赖 feat/group-chat 合入；P18/P19 收尾。

## 5. 与进行中分支的协调

- **feat/group-chat**（群组对话票 12 已提交、未并入 main，2026-10-24）：它与阶段 1 同改 `Stand.tsx` 周边。约定：feat/pjsk 的 P05 只抽接口不改行为、把冲突面压到最小；P14 排在 group-chat 合入 main 之后做，届时 rebase 本分支。
- **feat/deepgram**（另一 AI，占用主工作目录 `D:\project\eidolon-sc-next`）：本计划全程只用 worktree，不切主目录分支；预计无交锋面，合并顺序以 main 为准。
- **上游**：每阶段开工前 `git fetch upstream && git merge upstream/main` 进 main 再 rebase `feat/pjsk`（上游活跃，收窄后的冲突面已最小化）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| pixi-live2d-display 分支质量（Sekai-World 分支对 PJSK 模型的表情/多动作支持未实测） | P04 spike 先验证；不行退 lipsyncpatch；两分支接口同源，切换成本限于 P10 |
| 每模型表情映射 QA 成本（26 人 × 模型数） | 缩略图脚本扩「7 情绪 × 模型」矩阵截图；映射表数据化，集中在内容包审校 |
| Cubism Core 国内可达性与 CSP | 自托管进站点源（D4），不依赖官方 CDN、不给桶 origin 开 `script-src` |
| 许可证（Cubism 出版许可、原作素材既有风险之上再叠一层） | ADR-0031 写清立场与补救路径（同 ADR-0009 的接受+可补救模式）；部署者按营收确认出版许可豁免 |
| 上游合并撞上 rewrite 过的文件 | D1/D2 的收窄本就是为此：PJSK 新增文件与共享线不相交；每阶段开始先同步 main |
| SC 零回归被阶段 2 的文案外移打破 | P09 后必须跑一次通话/落地页 Playwright 对拍；i18n 键删除走 typecheck 兜底 |

## 7. 总验收标准

1. **SC 零回归**：基点行为一致（对话、通话、立绘、换装、缩略图、落地页）。
2. **PJSK 全链路**：一位角色文字对话 + 语音通话 + Live2D 立绘（取景/情绪/口型/换模型）+ 剧情回忆最小集。
3. **IP 收窄**：`grep -rnw "283" backend/src frontend/src` 另加 `シャニ`/`Shiny`（用词边界，避免 `light.ts` 的 `6.2831853` 数字常量与测试夹具永久误伤；夹具随 P09 改中性）仅命中内容包、适配器注册处与注释。
4. **决策落地**：ADR-0029/0030/0031 + `LICENSING.md` 修订合并。
5. **CI 绿**；本地验收清单通过。

## 8. 工作流约定（照仓库既有约定执行）

- 开工时用 `/to-tickets` 把本计划切成 `.scratch/pjsk/spec.md` + `.scratch/pjsk/issues/NN-<slug>.md`（本计划的票号是计划序号，切票时重新编号）。
- 实现流程照 `docs/agents/implementing.md`：第一张票提交后推 origin 开 draft PR；每张票 `sh scripts/affected-tests.sh <基点>` + `code-review` + 关票；波次收尾等 CI。
- 立绘素材、Cubism Core、PJSK 提取模型一律不进仓库；`EIDOLON_STAND_ASSETS_URL` 桶结构按 P04 产出的清单格式草案演进。
