# 群组对话票 12：数据包导出与导入

Status: done

群组已经有独立的成员、消息和回合表，但当前数据包在包含 `conversations` 时拒绝拥有群组的用户。继续保留这个阻断会让用户无法完整迁移自己的数据。本票只把群组生命周期数据纳入数据包，统计、记忆归属、成就和后台运行口径另开票；当前没有持久化 `group_calls`，因此不伪造通话记录。

## 目标

- 新增独立的 `groups` 数据包类别，保存群组标题、成员历史快照、群组消息和回合审计。
- 数据包格式升为 3；旧格式 1/2 继续导入，旧部署遇到 3 返回 `too_new`。
- 群组包可以单独导出/导入，也可以和现有类别一起导出；不再因存在群组而拒绝 `conversations` 导出。
- 导入后重新生成数据库 id，同时保持成员顺序、当前/已移除状态、作者快照、回复引用、mentions 和回合关联。
- 同一群组包重复导入不产生重复群组；坏引用、重复包内键、非法成员边界和越权数据全包原子拒绝。

## 格式设计

### manifest 与类别

- 后端 `FORMAT`、前端 `FORMAT` 和 `docs/data-package-format.md` 升为 3。
- `Category`/`CATEGORIES` 增加 `groups`，保持已有四类顺序并将 `groups` 放在末尾；`groups` 不依赖 `conversations` 或 `photos`。
- `PackageData.groups` 为可选字段，因此旧格式包没有该键仍能读取；v3 的 manifest 与 data 类别必须一致。
- `Imported` 增加 `groups` 数量；前端导入摘要和类别文案显示新增群组数。

### 群组记录

`groups` 中每条记录包含包内 `id`、`created_at`、`updated_at`、`title`、成员列表、消息列表和回合列表。成员保存 `character_id`、`position`、`added_at`、`removed_at`、`name_snapshot`；消息保存包内 `id`、`turn_id`、作者类型/id/名字快照、正文、日中段落、创建时间、回复消息包内 id 和 mentions；回合保存包内 id、幂等键、开始/结束时间、状态和 request fingerprint。只导出已经结束的回合；运行中的回合不会进入数据包。

角色已经从当前配置移除不影响导入：成员和历史作者依靠快照继续可读。导入时当前成员仍必须是 2–5 位，成员位置和历史成员重复记录原样保留。

## 实现

### 后端

- 在 `group_store.py` 增加数据包读快照和事务写入 seam，避免 `data_package.py` 复制群组 SQL；为导入群组增加来源 id/创建时间的幂等标识并兼容现有 SQLite 表。
- 在 `data_package.py` 增加 Pydantic 群组包模型、格式 3、导出读取、导入预检和原子写入；导入时映射群组/消息/回合 id，检查引用只指向同组更早消息，运行中回合按失败状态落库或拒绝，不能留下锁死群组。
- `DataPackages` 注入 `GroupStore`，移除 `GroupsUnsupported` 的正常阻断；`data_package_api.py` 删除该错误响应和旧文案，但保留其他类别/旧包行为。
- 账号删除、群组删除和现有数据库清理继续适用，不改变单角色数据。

### 前端与文档

- 更新 `frontend/src/lib/dataPackage.ts`、`frontend/src/lib/api.ts`、`DataPackageSettings.tsx` 和 `zh.ts`，让用户选择 `groups`、识别 v3 manifest，并在导入成功后刷新群组列表。
- 更新 `docs/data-package-format.md`、必要的 GLOSSARY/ADR 说明格式 3、群组数据字段和当前不包含持久化群组通话记录的边界。

## 测试与验收

- 后端覆盖格式 3、旧格式兼容、群组成员/消息/回合完整 round-trip、引用/mentions/作者快照、重复导入、坏引用/重复键/非法当前成员的原子拒绝、用户隔离和无群组/旧类别导出。
- 前端覆盖 `CATEGORIES`、manifest 识别、导入摘要和新 API 返回字段；现有单角色数据包测试全部保持。
- 运行相关 pytest、前端 Vitest、`npm run typecheck`、`sh scripts/check-discipline.sh` 和提交前 `sh scripts/affected-tests.sh <票 12 开工基点>`。
- 本地构建版 Playwright 验收选择 groups、导出、导入后列表显示；若 Next.js 安全漏洞终止构建检查仍存在，记录为环境验证缺口，不绕过检查。

## 实现说明

- `group_store.py` 提供群组快照读写 seam；导入为群组、回合和消息重新生成数据库 ID，并用来源 ID/创建时间去重。旧 SQLite 表会补齐来源列，运行中回合不会导出，恶意导入的运行中回合按失败落库。
- 数据包格式升为 3，新增独立 `groups` 类别；保留 v1/v2 读取规则，移除 `groups_unsupported` 阻断。导入预检校验成员边界、重复键、作者形状、回合/消息/回复引用，并在一个事务中写入。
- 设置页新增群组类别和导入数量；成功导入群组后发送 `eidolon:groups-changed`，对话列表按事件重新加载并清除旧错误。
- 未新增持久化群组通话记录；格式文档明确该边界。

## 验证

- `uv run pytest tests/test_data_package.py tests/test_data_package_conversations.py tests/test_data_package_groups.py -q`：31 passed。
- `uv run pytest tests/test_group_store_api.py tests/test_group_turn.py tests/test_data_package_groups.py -q`：21 passed。
- `uv run ruff check ...`：通过；`uv run pyright`：0 errors；前端 `npm run typecheck`、`sh scripts/check-discipline.sh`：通过。
- `sh scripts/affected-tests.sh 911624a4`：后端 210 passed，前端 36 files/634 tests passed，typecheck passed。
- 本票未执行本地 Playwright：当前仓库的 Next.js 安全检查仍会在构建阶段终止，沿用前票记录的环境阻断。

## 不在本票

- 不把群组回合/通话计入单角色统计、成就或记忆；不新增 `group_calls` 导出字段。
- 不改变群组页面、成员管理和通话协议；不新增群组共享或跨用户协作。
