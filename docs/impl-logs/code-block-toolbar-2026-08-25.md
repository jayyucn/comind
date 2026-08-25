# 代码块工具栏优化：Header 布局 + 折叠 + 自动换行 + 语言保存修复

- 日期：2026-08-25
- 范围：
  - `src/components/Block/handlers/code/CodeMirrorEditor.vue`（header 布局重构、折叠、wrap toggle、语言选择）
  - `src/components/Block/handlers/code/index.ts`（label 改为「代码块」）
  - `src/stores/blocks.ts`（`updateBlockProperties` 修复：写库后不同步内存缓存 → 语言切换退出编辑态后变回旧值）
  - `src/components/Block/handlers/code/CodeMirrorEditor.test.ts`（新增折叠/wrap/语言保存测试，修复 fake-timers 污染）

## 需求（经 grilling 收敛）

1. **复制图中布局**：代码块顶部常驻 header 栏——左侧 `▼ 代码块`（折叠按钮 + 类型标签），右侧 `语言 ▾ | 自动换行 | 复制`。
2. **加折叠功能**：点击左侧 chevron 折叠/展开代码正文（仅本地状态，不持久化）。
3. 后续调整（用户第二轮反馈）：
   - 移除头部背景（header 透明）；
   - 右侧 3 个按钮只在 hover 代码块时显示；
   - 编程语言选中后要**保存**（修复"退出编辑态后变回去，只有刷新才生效"）。

## 决策

### D1：header 常驻 + hover 显示工具栏

- header 本身常驻（透明无底色），右侧 `.code-toolbar` 默认 `opacity: 0`，`.code-editor-wrapper:hover` 时 `opacity: 1`。
- 折叠时 header 仍常驻，可继续复制/换语言。

### D2：折叠与自动换行均为组件本地状态

- `collapsed`、`wrap` 均为 `ref(false)`，刷新块即重置，不写 store。
- wrap 切换通过重建 CodeMirror（`EditorView.lineWrapping` extension 不可热插拔），保留焦点。
- 折叠用 `v-show`（`display: none`），不销毁 CodeMirror 实例，展开时 `nextTick` 回焦。

### D3：语言保存走 propertyStore 完整路径（bug 修复）

**问题**：`blocks.ts` 的 `updateBlockProperties` 直接 `client.setProperty` 只写数据库，未刷新 `propertyStore` 内存缓存 → 编辑态内语言选择器（本地 `currentLang`）显示新语言，但退出编辑态后 Block 重新渲染时 `getBlockProperty('language')` 读到的还是旧值 → "变回去了，只有刷新才生效"。

**修复**：`updateBlockProperties` 改为调用 `propertyStore.setProperty`（内部写库 + `loadBlockProperties` 刷新缓存 + `blockCardStore.invalidate`），再 `structureVersion++`。

**类型推断差异**：旧实现字符串→`'string'`、其余→`'object'`；新实现走 `inferType`（string/number/boolean/date/array/page），更精确。现有调用方（language、sourceBlockId/sourcePageId、useBlockPropertySync 通用 setProperty）均为字符串或对象，行为兼容。

### D4：label 取 registry

- header 左侧标签用 `getHandler('code')?.label ?? '代码块'`，`index.ts` label 已从 `'Code'` 改为 `'代码块'`。

## 验收

- `CodeMirrorEditor.test.ts` 27 个测试全过（header/hover/折叠/wrap/语言 emit/复制）。
- `blocks.test.ts` 67 个测试全过。
- 连续 5 次合跑稳定（修掉了 `vi.useFakeTimers` 污染 + isVisible 依赖 offsetParent 的 flaky 断言）。

## 已知边界

- 折叠/wrap 状态不持久化：刷新块即重置（用户明确选择）。
- `property.test.ts`、`property-advance.test.ts`、`notification.test.ts`、`edit-render-timing.test.ts` 的失败为**既有测试与代码演进脱节**（mock 旧 `core` 接口 / 缺 `getDateRefsByBlock`），与本次改动无关。
