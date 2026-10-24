# plan-pjsk-01：立绘引擎接口化与 stand_format 配置链路

Status: reviewed（已按 review agent 意见修订，可开工）
分支：`feat/pjsk` · worktree `D:\project\eidolon-sc-next-worktrees\feat-pjsk`
总计划：`plans/plan-pjsk.md`（本计划 = 总计划 P05+P06 的最小实现，先做引擎与配置面，不动渲染内容）

## 1. 目标

让「立绘用哪套引擎」由内容决定的第一段链路落地：前端从「直接 new Spine 引擎」改为「经工厂按格式分发」，后端把格式随角色配置声明、校验并经 API 下发。**本计划不写任何 Live2D 渲染代码**——plan-02 才引入。

**硬约束（SC 零回归）**：

- 不带 `stand_format` 的现有 `characters/characters.toml` 行为逐字节不变（默认 `spine-3.6`）。
- 缩略图脚本 `frontend/scripts/stand-thumbnails.mts` 必须在本计划内改好。它对引擎的引用在 PAGE 模板**字符串**里（`:198` 的 import、`:204` 的构造），tsc 不解析字符串字面量——typecheck 全绿也可能运行时 404，必须以 grep 兜底（§5）。
- 本计划不触碰 `characters/`、`corpus/`、数据库；纯增量。

## 2. 现状（已核实，含 review 修正）

- `frontend/src/components/conversations/stand/StandEngine.ts`：`class StandEngine`，实例公开面 = `load(outfit)` / `direct(direction, reducedMotion)` / `setStill(bool)` / `setPaused(bool)` / `framing`（可写属性）/ `dispose()`；构造 `new StandEngine(canvas, spine, framing, maxPixelRatio?)`。**模块导出面**还有 `Framing`（`:23`）与 `StandUnavailable`（`:44`），plan-01 一并迁到中立文件。
- `frontend/src/components/conversations/stand/Stand.tsx`：`:87-99` 是唯一浏览器构造点；以类为类型注记的位置有三处——`engine` ref（`:53`）、`ready` state（`:54`）、局部 `created`（`:86`）。
- `<Stand>` 调用点恰三处：`CallLayer.tsx:383`、`OutfitPicker.tsx:73`、落地页 `StandSlot.tsx:51`。**落地页数据流**（review 修正）：`StandSlot` 只收 `outfit` prop，不认识 character；判空在父级 `Spectrum.tsx:127`（`plate.outfit`）与 `Call.tsx:101`（`speaker.outfit`），不在 StandSlot。
- `OutfitPicker` 的 props 里没有 character（只有 isOpen/onOpenChange/isWide/isReducedMotion/color/outfits），format 需从 `ConversationView.tsx:470` 穿一个新 prop 进去。
- `frontend/scripts/stand-thumbnails.mts`：Node 脚本，`ts.transpileModule` 现场转译引擎文件（只转译不检查）；引擎引用在 PAGE 模板字符串里。`frontend/tsconfig.json` 的 include **含 `**/*.mts`**（review 实测），所以脚本文件本身的类型错误 typecheck 能查，但字符串里的坏点查不到。
- `backend/src/eidolon/characters.py`：`_OUTFIT = re.compile(r"(stand|stand_costume)/[0-9]{10}")`（`:68`）校验 `default_outfit`；`Character` dataclass（`:120`）无格式字段；解析入口 `_parse_character`，`default_outfit` 校验在 `:271-278`；既有错误文案风格见 `:275-278`。
- `backend/src/eidolon/app.py`：`_stand`（`:186-196`，review 修正行号）构造 `stand` API 对象，仅在 `idol_id + default_outfit + assets_url` 齐备时下发；`/api/characters`（`:482`）是唯一序列化处。
- `backend/tests/test_characters.py:465-471`：对 `stand` 字典做**精确相等**断言——加 `format` 字段后该测试必红，须同步更新。
- 前端 `frontend/src/lib/api.ts`：`Stand`（`:85`）、`Outfit`（`:96`）、`Character.stand`（`:37`）。

## 3. 改动面（文件级）

### 3.1 前端

**新文件 `frontend/src/components/conversations/stand/standEngine.ts`**：

```ts
import type { Outfit } from "@/lib/api";
import type { StandDirection } from "@/lib/standAnimations";

/** 立绘用哪套引擎渲染（characters.toml 的 stand_format，随角色 API 下发）。 */
export type StandFormat = "spine-3.6" | "live2d-cubism4";

/** 取景（spec「渲染」）：手机「大立绘」贴着头顶、到膝；电脑「半身 ADV」…；全身。 */
export type Framing = "knees" | "waist" | "full";

/** 这台设备上画不了立绘。 */
export class StandUnavailable extends Error {}

/** 立绘引擎的公开面（spec「立绘指令」「渲染」）：与 Spine 实现今天的公开面逐字一致。 */
export interface StandEngine {
  framing: Framing;
  load(outfit: Outfit): Promise<void>;
  direct(direction: StandDirection, reducedMotion: boolean): void;
  setStill(still: boolean): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** 唯一的分发点：按格式懒加载对应 runtime 再构造引擎。live2d-cubism4 由 plan-02 实现，
 *  在它落地前与未知格式一样抛 StandUnavailable。 */
export async function createStandEngine(
  canvas: HTMLCanvasElement,
  format: StandFormat,
  framing: Framing,
  maxPixelRatio?: number,
): Promise<StandEngine>;
```

`Framing` 与 `StandUnavailable` 从 Spine 文件**迁入**本文件（中立归属：两者是 Live2D 引擎同样要用的，review 修正）；`SpineStandEngine.ts` 与 `Stand.tsx:10` 的 import 跟随调整。

**改名 `StandEngine.ts` → `SpineStandEngine.ts`（`git mv`）**，类改名 `SpineStandEngine implements StandEngine`（`implements` 从 `./standEngine` import）。成员签名与行为逐字不动。

**`Stand.tsx`**：

- `Props` 增必填项 `format: StandFormat`。
- 三处以类为类型的位置（`:53`/`:54`/`:86`）全部改为接口类型。
- 挂载 effect 的 `loadSpineRuntime().then(...)` 段替换为 `createStandEngine(target, format, current.current.framing, current.current.maxPixelRatio)`，后续 `setStill/setPaused/direct` 顺序不变。

**调用点（三处，逐处登记）**：

| 调用点 | format 来源 |
|---|---|
| `CallLayer.tsx:383` | 手里有 character：`character.stand.format` |
| `OutfitPicker.tsx:73` | props 无 character：从 `ConversationView.tsx:470` 新穿 `format` prop |
| `StandSlot.tsx:51`（落地页） | 本轮显式传字面量 `"spine-3.6"`：落地页当前是 SC 专属视觉世界（ADR-0016），character 数据在这里要穿 `Landing→Spectrum/Voice→StandSlot` 四五个文件，本轮不划算；**登记为已知简化**，多作品落地页（总计划阶段 5）时收编 |

**`frontend/scripts/stand-thumbnails.mts`**：更新 PAGE 模板字符串里的 import 路径（`/src/components/conversations/stand/SpineStandEngine`）与构造（`new SpineStandEngine(...)`）。它仍是 Spine 专属管线，不进工厂。

### 3.2 后端

**`backend/src/eidolon/characters.py`**：

- 常量 `STAND_FORMATS = ("spine-3.6", "live2d-cubism4")`；模块 docstring 补一段 `stand_format` 说明（照「Optionally, she also …」文风）。
- `Character` dataclass 增字段 `stand_format: str = "spine-3.6"`。
- `_parse_character` 里 `default_outfit` 校验旁：缺省跳过；给了但不在 `STAND_FORMATS` 时报 `CharacterConfigError`，文案 `角色 {label} 的 stand_format 应为 spine-3.6 或 live2d-cubism4，现在是 {value!r}`。
- 本计划**不**放宽 `_OUTFIT` 正则（plan-02 随 PJSK 内容包一起做）。

**`backend/src/eidolon/app.py` `_stand`**：返回对象增加 `"format": character.stand_format`。

**`backend/tests/test_characters.py`**：`:465-471` 的精确相等断言字典加 `"format": "spine-3.6"`（既有测试同步更新，不是新测试）。

**前端 `frontend/src/lib/api.ts`**：`Stand` 类型增加 `format: "spine-3.6" | "live2d-cubism4"`（与前端 `StandFormat` 同一字面量联合，不引入后端枚举）。

## 4. 实现说明与取舍

- **接口不加 `url`**：现有类也没公开它，与今天公开面一致（最小面）。
- **缩略图脚本不进工厂**：Spine 专属、Node 无打包环境；等 Live2D 需要缩略图时再议（总计划 P12 的情绪矩阵截图走 Playwright）。
- **plan-01 不写 live2d 空壳类**：工厂里 `live2d-cubism4` 与未知格式同抛 `StandUnavailable`，这本身就是占位。
- **落地页字面量**：见 3.1 表格，是本轮登记的已知简化，不是遗漏。

## 5. 测试计划

- 后端 `backend/tests/test_characters.py`：
  - 既有 `stand` 形状断言（`:465-471`）更新（见 3.2）。
  - 新增三例：缺省默认 `spine-3.6`；`stand_format = "live2d-cubism4"` 解析通过；非法值报 `CharacterConfigError`。
- 前端 `frontend/src/components/conversations/stand/standEngine.test.ts`（vitest，无 jsdom 环境）：
  - `vi.mock("./spineRuntime")` 返回假 spine：`webgl.ManagedWebGLRenderingContext`/`SceneRenderer`/`AssetManager` 用极简 stub 类（`gl = { pixelStorei() {}, isContextLost: () => false }`、`camera`、`begin/end/drawSkeleton/dispose` 空实现）；canvas 用 `{ addEventListener() {} }` 假件——构造不触碰 `read()`，这些够了。
  - 三例：`spine-3.6` → resolve 出 `SpineStandEngine` 实例；`live2d-cubism4` → reject `StandUnavailable`；未知字符串（类型上不合法，运行时仍要拒）→ reject。
- 门禁：`sh scripts/affected-tests.sh <基点>`、`npm run typecheck`、`uv run pyright`、`uv run ruff check`。
- **缩略图脚本的兜底**（review P1 修正）：改完 PAGE 字符串后，`grep -rn "stand/StandEngine\|new StandEngine" frontend/` 必须零命中（旧文件路径与旧类构造都已不存在；新接口无构造，`new StandEngine` 无歧义）。typecheck 查不到字符串里的坏点，这道 grep 是唯一保险。

## 6. 验收标准

1. `grep -rn "stand/StandEngine\|new StandEngine" frontend/` 零命中；`frontend/src` 里 `new SpineStandEngine` 仅工厂一处（脚本里那处在 `frontend/scripts/`，另计）。
2. 三处 `<Stand>` 调用点均传 format（两处来自数据流、落地页字面量），与本计划 3.1 表格一致。
3. 后端 `stand` API 带 `format`；`test_characters.py` 四例（一更新两新增；「缺省默认 spine-3.6」由更新后的既有断言覆盖，按 CODING_STANDARDS 不再单写）绿。
4. `affected-tests` + typecheck + pyright + ruff 全绿。
5. SC 语义零改动：`git diff` 中 `SpineStandEngine.ts` 相对原 `StandEngine.ts` 仅类名/import 归属差异（review agent 核对）。

## 7. 风险

- 缩略图脚本：真正的坑在 PAGE 字符串（§1/§5 已覆盖）；`node --experimental-strip-types` dry-run 只能证明脚本文件可解析、测不出字符串坏点，不作为验证手段。
- API 加字段对旧前端无兼容问题（新增字段，旧前端忽略）。
- 落地页字面量在多作品落地页时必须收编——已登记进总计划阶段 5 的口径。

## 8. 提交

实现 → code review（review agent）→ 修复 → 提交：

`feat: pjsk 计划 01——立绘引擎接口与 stand_format 配置链路`

推 origin 并开 draft PR（照 `docs/agents/implementing.md`），之后每张计划推一次。
