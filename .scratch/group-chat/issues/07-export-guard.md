# 数据包导出安全门

Type: task
Status: done

Blocked by: 06

## Acceptance Criteria

- [x] 有群组时导出包含 `conversations` 的数据包明确返回 `groups_unsupported`。
- [x] `export-check` 与实际导出都覆盖该检查，避免竞态下静默丢数据。
- [x] 不含 `conversations` 的类别和无群组用户行为不变。
- [x] 前端显示群组数据尚未支持导出的明确提示。
- [x] 建立并完成本票独立计划。

## 实现说明（票 07）

- `DataPackages` 在导出预检查和持锁实际导出前查询当前用户群组，实际读数据的同一数据库快照再次验证，新增 `groups_unsupported` 409；不改变数据包格式和导入逻辑。
- 设置页复用现有失败链路，明确提示群组消息尚未支持随数据包导出。
- 检查：后端 data package/group API 27 项、ruff、pyright；前端 data package 14 项、typecheck、shadcn 纪律检查通过。
