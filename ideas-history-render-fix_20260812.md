# 历史点滴渲染修复 + 只读强制（2026-08-12）

## Objective
1. IdeasHistoryItem 历史点滴 block 强制渲染态（不可编辑）
2. 修复历史面板渲染异常：`((type))[[page]]`、`@2026-08-11`、`📅` 等被渲染为纯文本无样式，应与今日面板一致

## 决策（grill-me 已确认）
- 问题 1：方案 A —— Block 组件模板加 `!isFrozen`，全局复用 `useIdeasFreeze`，不新增 prop/传递链
- 问题 2：方案 B —— Rust 新增批量接口 `get_pages_with_blocks`
- 防卡顿：单次 IPC 批量渲染，不引分帧/虚拟滚动

## 根因
历史面板走 `loadMultiPageBlocks` → `getBlocksByPage`，返回的 block **不含 renderSegments**；`BulletRender.vue` 缺 renderSegments 时 fallback 纯文本（仅 #tag 高亮）。今日面板走 `loadPageBlocks` → `getPageWithBlocks`（含 render_segments），故样式正常。

## 改动（8 文件，+156/-29）
| 文件 | 改动 |
|------|------|
| `src-tauri/src/commands.rs` | 新增 `get_pages_with_blocks` 命令：遍历 page_ids 调 `build_page_with_blocks`，容忍缺失页面（skip 不整体失败），单次 IPC |
| `src-tauri/src/lib.rs` | `generate_handler!` 注册新命令 |
| `src/wasm/tauri-client.ts` | 新增 `tauriGetPagesWithBlocks` 桥接 |
| `src/wasm/client.ts` | CoreClient 接口 + TauriClient 实现（`parseJsonResult` 包裹）；WasmClientAdapter 返回 `[]`（Web 历史面板依赖 Rust） |
| `src/stores/blocks.ts` | `loadMultiPageBlocks` 改调 `getPagesWithBlocks`，映射 `renderSegments: brd.render_segments \|\| []` + `properties`，保留去重与 structureVersion++ |
| `src/components/Block/index.vue` | editor 分支 `v-if="isActive && handler && !isFrozen"`（frozen 强制渲染态，防御性兜底） |
| `src/components/BlockList.vue` | `handleDocMouseUp` 激活分支加 `if (!isFrozen.value)`（阻止历史 block 点击激活 editor） |
| `src/stores/blocks.render-segments.test.ts` | 新增 `loadMultiPageBlocks` describe（2 用例：携带 renderSegments+去重、缺失页面跳过）；并补 mock `isTauriEnvironment: () => false`（修复 4 个 pre-existing flushSave 失败） |

## 验证结果
- `cargo check`：✅ 仅 1 pre-existing warning（WsSource）
- `vue-tsc --noEmit`：✅ EXIT=0
- `blocks.render-segments.test.ts`：9/9 ✅（含 2 个新用例）
- `blocks.test.ts` / `BlockList.test.ts` / `IdeasHistoryItem.test.ts` / `BulletRender.test.ts`：全过
- **历史失败确认（与本次改动无关，stash 对照验证）**：
  - `Block/index.test.ts` 4 个删除关系清理用例：`UNIQUE constraint failed: Page.title`（SQLite 层）
  - `useBlockEditorLifecycle.test.ts` 1 个 `opens relationship switch menu on rel-type-label click`

## 关键结论
- 激活入口：`BlockList.vue handleDocMouseUp` → `editorStore.activateBlock`（Block/index.vue 模板本身不调 activateBlock）
- `loadMultiPageBlocks` 调用方（`loadMonthData`/`reloadHistory`）无需改动——签名未变
- WASM fallback 返回 `[]` 的假设：IdeasHistoryList 仅 Tauri 使用；若未来 Web 模式挂载历史面板需改为循环 `getBlocksByPage`

## 待办
- 手动验证：`npm run tauri dev` → 历史面板切月份，`((type))[[page]]`/`@date`/`📅` 样式与今日一致；点击历史 block 不进编辑态
- 新增 block 保存后 renderSegments 写回链路不受影响（flushSave 逻辑未动）
