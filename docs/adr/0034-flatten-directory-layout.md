# ADR-0034: 目录扁平化（消除 comind/comind 双层嵌套）

- **Status**: Accepted
- **Date**: 2026-08-24
- **Deciders**: jay

## Context

仓库在扁平化前存在两层嵌套：`D:\comind\`（git 仓库根，承载管理类文件如 `AGENTS.md`、`docs/`、`memory/`、`outputs/`、`.workbuddy/`）与 `D:\comind\comind\`（应用本体，含 `src/`、`crates/`、`src-tauri/`、`package.json` 等）。这种结构带来以下问题：

1. **路径冗长易错**：任何指向应用代码的绝对路径都要写 `D:/comind/comind/src/...`，开发者在引用、脚本、文档中频繁出错。
2. **六处同名撞车**：`CONTEXT.md`、`docs/`、`README.md`、`.gitignore`、`.trae/`、`.vscode/` 在两层都存在，含义与内容不同，造成混淆。
3. **ADR 编号重号**：外层 `docs/adr/` 有 `0001-0013`，内层 `comind/docs/adr/` 有 `0007-0026`，`0007-0013` 在两边都有且内容完全不同。
4. **图谱与工具失效**：`graphify-out/`（代码知识图谱）在两层都存在，且因路径变化全部过期。

目标：消除嵌套，使**仓库根 = 应用根**，`src/`、`crates/`、`package.json` 与 `AGENTS.md`、`docs/`、`memory/` 共存于同一层。

## Decision

采用**完全扁平化**：将 `comind/comind/*` 全部上移至 `D:\comind\`，仓库根即应用根。撞车文件按以下策略合并：

| 撞车项 | 决策 |
|--------|------|
| `CONTEXT.md` | 以内层中文版（269 行，完整领域术语表）为基底，把外层英文版独有术语（Screen / View / viewKind / View Config / Custom Cell / Generic Views / Query Page Frame / Entity Default Layout + 剪贴板系列 8 条）作为第七章合并追加 |
| `README.md` | 以外层项目总览为基底，并入内层前端应用说明（目录结构、核心概念、开发命令、质量门禁）；更新项目结构图与 `cd comind` → 根级路径 |
| `docs/` | 外层为骨架（`1-overview`~`7-sidebar` + `agents/` + `plans/` + `adr/`），内层实现日志 → `docs/impl-logs/`、重构笔记 → `docs/refactor/`、规格/规划 → `docs/specs/` |
| `.gitignore` | 合并两层：保留内层前端标准项（node_modules/dist/.vscode 等）+ 外层管理类忽略项，并去除原 `comind/` 路径前缀 |
| `.trae/` `.vscode/` | 合并两目录内容（外层 rules/scripts/specs + 内层 documents；外层 settings.json + 内层 extensions.json） |
| `design-preview.html` | 留外层大版本（1616 行），内层删除 |
| 散落 Python 脚本（~24 个 fix_/test_/patch_*.py） | 移入 `scripts/archive/` 归档，不删除 |
| `comind-android-mobile/` | 上提到根，保持 git 忽略 |
| 构建缓存（node_modules/target/dist/pkg） | 随目录移动，保留缓存以加速验证 |
| `graphify-out/` | 两个旧版均删除，重构后 `graphify update .` 重新生成 |

### ADR 重编号映射

外层 `docs/adr/0007-0013`（与内层 `0007-0026` 重号但内容不同）重编号为 `0027-0033` 追加到内层序列之后，保留外层 `0001-0006` 原样：

| 原编号 | 新编号 | 标题 |
|--------|--------|------|
| 0007 | 0027 | TableView 与 Task 解耦（通用字段驱动表） |
| 0008 | 0028 | 三个视图全部通用化并迁移至 components/views |
| 0009 | 0029 | Screen→Tab 两级 NamedView 栏 |
| 0010 | 0030 | TableView 字段管理面板 |
| 0011 | 0031 | TableView 自定义单元格渲染器 |
| 0012 | 0032 | z-index 层级 token 化 |
| 0013 | 0033 | TableView 列宽拖拽缩放 |

最终 ADR 序列连续无重号：`0001-0026`（原内层 + 外层 0001-0006）+ `0027-0033`（原外层 0007-0013 重编号）。所有引用旧编号的文档（`docs/agents/domain.md`、`docs/glossary.md`、`docs/impl-logs/architecture-deepening-backlog.md`）已同步更新。

## Consequences

**正向：**
- 路径从 `D:/comind/comind/src/...` 简化为 `D:/comind/src/...`，消除嵌套心智负担。
- 单一 `CONTEXT.md`、`docs/`、`README.md`、`.gitignore`、`.trae/`、`.vscode/`，无同名歧义。
- ADR 编号全局唯一、连续。
- 应用代码与管理工作文件在同一层，工具链（Tauri/Vite/Cargo）配置均为相对路径，无需改动即可工作。

**负向 / 风险：**
- git 历史中这些文件显示为「删除旧路径 + 新增新路径」，未强制走 `git mv`（因 Windows 文件锁与沙箱限制，部分目录用 robocopy /MOVE 复制法移动）。重命名历史可用 `--follow` 部分追溯，但不如纯 `git mv` 干净。
- 内层 `comind/` 残留被锁的 `target/`（Rust 编译缓存，git 忽略）与 `graphify-out/`（git 忽略），因环境 safe-delete 拦截无法直接删除；二者均不进 git，待锁释放后可手动清理。
- `cargo check` 首次全量类型检查较慢（依赖树编译），但配置正确、无编译错误。前端 `vue-tsc -b` 仅有 pre-existing 的 TS6133（unused variable）警告，与本次移动无关、无模块解析失败。

**后续：**
- 运行 `graphify update .` 重新生成代码知识图谱。
- 锁释放后清理 `comind/target/` 与 `comind/graphify-out/` 孤儿目录（可选）。
