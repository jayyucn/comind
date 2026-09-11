# Block 拖拽实现（vue-draggable-plus / Sortable.js）

> 版本：v0.3
> 日期：2026-09-11
> 状态：**现行实现**。v0.2 的 `useSortable` + `moveBlock` 增量写路径已于 2026-09-11 的拖拽重构中作废，差异见 §11。

---

## 1. 核心约束

| 约束 | 说明 |
|------|------|
| **C1 单编辑器** | 任何时刻只有 1 个 tiptap 实例，拖拽不引入新实例 |
| **C2 Block 唯一数据单元** | 数据变更只经 Pinia blocks store；Sortable.js 只负责 UI 层 |
| **C3 状态驱动** | DOM 变更必须与 Pinia 状态一致，不允许 DOM 驱动数据 |

落库路径是「一次性完整树 diff」，而非增量移动：Sortable 先让 DOM / v-model 动，`@end` 后把整棵树同步回 store（§7）。

---

## 2. 组件与职责

```
BlockDraggableList.vue          唯一接线（根级与子级共用一份）
  └─ useBlockDragDrop.ts        放置判定 / 指示器 / @move @end 处理
       ├─ resolveDropAction     放置语义判定（纯函数）
       └─ applyDropTarget       按意图校正树（纯函数）

调用方
  BlockList.vue      v-model="tree"              parentId = null（根级）
  Block/index.vue    v-model="node.children"     parentId = node.id（子级，depth + 1）
  BlockModal.vue     node.children + provide('onDragEnd')   （子树编辑器）
```

两个拖拽容器**只有一份接线**。2026-09-11 之前根级（BlockList）与子级（BlockChildren）各手写一遍几乎相同的配置，复制粘贴漂移出「根级起手拖拽全程无指示线」（`@move` 只绑在子级）等问题。`BlockChildren.vue` 已删除，职责并入 `BlockDraggableList.vue`。

落库由调用方经 `inject('onDragEnd')` / `@drag-end` 注入，终点统一是 `syncTreeToStore`。

---

## 3. 接线配置

`BlockDraggableList.vue` 上的 VueDraggable 配置即唯一事实来源：

| Prop | 值 | 说明 |
|---|---|---|
| `group` | `{ name: 'blocks-' + pageId, pull: true, put: true }` | 同页可互拖；group 带 pageId 以隔离跨页 |
| `handle` | `.bullet-dot` | 只能从 bullet 起拖 |
| `filter` | `.bullet-chevron` | 折叠箭头不触发拖拽（配 `:prevent-on-filter="false"` 让它的 click 照常生效） |
| `force-fallback` | `true` | 统一走 pointer 事件 + ghost，不依赖 native DnD |
| `fallback-tolerance` | `5` | 移动超过 5px 才进入拖拽态 |
| `animation` | `200` | |
| 三个态 class | `block-ghost` / `block-drag` / `block-chosen` | 样式见 `src/styles/components/_block.scss` |
| `empty-insert-threshold` | `0` | |
| `data-parent-id` | `parentId ?? ''` | **不可省略该属性**：`handleDragMove` 靠空串判定根级；`_reset.scss` 靠该属性区分拖拽容器与 Sortable 占位元素 |
| `@start` | `editorStore.deactivateBlock()` | |
| `@move` | `handleDragMove` | 返回 `false` 可阻止 Sortable 承接 |
| `@end` | `handleBlockDragEnd` | |

---

## 4. 事件模型（Sortable 既有行为，务必记住）

### 4.1 回调按「拖拽起始容器」路由

`_prepareDragStart` 把 `rootEl` 写为模块级变量（整个拖拽期不变），`_onMove` 从 `fromEl[expando].options.onMove` 取回调 —— **`@move` 属于起始容器，`evt.to` 才是当前悬停容器**。同一机制下还有两项：

- `_appendGhost` 的 `container = rootEl`（决定 ghost 的包含块与定位父级）
- `revert = parentEl !== rootEl`

### 4.2 `@end` 在源容器触发，`@move` 在目标容器触发

跨容器拖拽时两者不在同一组件实例上；但 vue-draggable-plus 的 v-model 同步是完整的（`onRemove` 源 + `onAdd` 目标都会 mutate），所以 `@end` 之后**起始容器实例**持有的完整树一定反映最终结构。

因此：**跨容器落库只能靠 `@end` 后的完整树**，不能靠源 Block 的局部 `node.children`（会丢）。

### 4.3 fallback 模式的副作用

`force-fallback: true` ⇒ Sortable 绑 pointer 事件而非 mouse，并起 `setInterval(_emulateDragOver, 50)` 轮询驱动 `_onDragOver`。两个可观察后果：

- fallback 路径**不打 `dragClass`**（`!fallback && toggleClass(...)`）；
- `@move` 只在「悬停块变化」时触发 —— 同一块内横向微调不会重复触发，指示器因此只在块间移动时刷新。

---

## 5. 放置判定 —— `resolveDropAction`（纯函数）

光标相对**目标块整行（`.block-row`）**的位置决定语义（左右阈值各 15px，见 `src/composables/useDragDrop.ts`）：

| 光标区 | 条件 | 结果 |
|---|---|---|
| 左区 | `x ≤ row.left + 15` | 目标有父级 → `promote`（提升到目标父级、位于目标之前）；目标已在根级 → `sort`（before 目标） |
| 右区 | `x ≥ row.right - 15` | `nest`（成为目标块的子节点，追加到末尾） |
| 中区 | 其余 | `sort`（按上下半区决定 before 目标 / before 其后继） |

**水平基准必须是行矩形，不能是 bullet 矩形**：bullet 实测宽仅 20px，`left + 15 = right − 5 > right − 15` ⇒ 中区为空集，`sort-after` 永远无法用手势表达（2026-09-11 修复，见 §10.1）。行矩形宽数百 px，三区都可用。

⚠️ 单测里的 `bulletRect` 是宽 50px 的假数据，中区「看起来」可达 —— 改阈值时必须同时按真实 20px 尺寸验证；`useBlockDragDrop.test.ts` 有一条专门的对照用例（同一个光标位置：bullet 基准判 `nest`、行基准判 `sort`）。

`DropTargetGeometry.rowRect` 是可选字段，缺省退回 `bulletRect`（兼容既有单测与旧调用）。

`readDropGeometry` 是模块内唯一接触 DOM 的入口（读 `data-block-id`、bullet rect、`rowRect`、父块 `data-parent-id`、`nextElementSibling`）；`findDropTarget` 只是它加 `resolveDropAction` 的适配层。

---

## 6. 落位校正 —— `applyDropTarget`（纯函数）

Sortable 自身只做「同级重排 + 相邻容器吸附」，与判定意图并不一致（实测：右区画 `nest` 线却落成 sort）。因此 `@end` 时按最后一次 `@move` 记录的意图重排树：

```ts
applyDropTarget(tree: TreeNode[], draggedId: string, target: DropTarget): boolean
```

判定顺序：

1. `target.action` 为空 → `false`
2. `toParentId` / `beforeId` 指向被拖块自身 → `false`（已在目标位置）
3. `locate(draggedId)` 失败 → `false`
4. 目标父级或 `beforeId` 落在被拖块子树内 → `false`（防循环）
5. 摘除节点 → 插入 `toParentId` 的 children（`beforeId` 之前；找不到则 push 末尾）

「先摘除再定位 `beforeId`」是刻意的：索引必须与目标列表的当前状态一致。

意图来源：`handleDragMove` 每次成功判定都暂存 `pendingIntent` / `pendingDraggedId`；早退分支不记录，但**也不清除**已记录的意图。

`@end` 的判据是「`pendingIntent` 是否存在」，**不能用 `indicatorVisible`**：拖拽末段指针常落在被拖块自身或其它无效位置（ghost 跟随指针，指针就压在它上方），此时 `handleDragMove` 会 `clearIndicator()` 把线隐藏，但用户最后看到的那条线依然有效 —— 用它作判据会连带作废意图，表现为「明明看到 nest 线，落位却按 Sortable 自然结果」（实测：拖到目标行右端后落位跑到了隔壁块下）。`pendingIntent` 只在成功判定分支赋值、且每次 `@end` 后重置，不会跨次残留。

---

## 7. 落库 —— 单一写路径

```
拖拽结束
  → handleBlockDragEnd()     回传 DragEndIntent | null，并清指示器
  → 调用方                   applyDropTarget(tree, intent.draggedId, intent.target)   校正
  →                          syncTreeToStore(tree, rootBlockId, blockStore.blocks)     完整树 diff
                               递归设置 block.parentId；按顺序重发 pos（1000 / 2000 / 3000 …）
  →                          blockStore.scheduleSave(id)                              每 block 独立 debounce
  →                          blockStore.structureVersion++ → BlockList watch → syncFromStore() 重建 tree
```

- **pos 策略**：`syncTreeToStore` 对整棵树重新分配连续 pos（gap 1000）。`safeCalcInsertPos`（取中间值 + 间隔耗尽重编号，`src/stores/blocks.ts`）**仍在**，但只服务非拖拽插入路径（`createBlock` / `insertSiblingAbove` / `insertAtPosition` / `mergeWithPrevious` / `indent` / `outdent` / `pasteBlocks`）；拖拽路径已不再调用它。随 `moveBlock` 一并删除的是 `src/stores/moveBlock.test.ts`。
- **子节点跟随**：跨父级移动**本应**只改被拖块自己的 `parentId` / `pos`（后代的 `parentId` 指向被拖块，无需修改）—— 但实测跨容器拖拽会破坏这一点，见 §10.2。
- **`parent_id` 语义**：`BlockService::update` 的 `parent_id: None` 意为「不修改」，表达不了「移到根级」；`save_blocks` 以传入值为权威，在 `update` 之后用 `BlockService::set_parent_id` 补写不一致（含清空为 NULL）。改这块时勿把这一步当冗余删掉。
- **三处注入同源**：`BlockList.handleDragEnd`、`BlockModal` 的 `provide('onDragEnd')`、`Block/index.vue` 的透传 —— 终点都是 `syncTreeToStore`。
- **弹窗子树**：`BlockModal` 的树以弹窗根块为根，意图里的 `toParentId === rootId` 先归一化为 `null` 再交给 `applyDropTarget`。

---

## 8. 循环嵌套防护

| 层 | 位置 | 手段 |
|---|---|---|
| 拖拽中 | `handleDragMove` | ① `related` 落在被拖块自身 → `return false`（阻止 Sortable 承接）② `toEl.dataset.parentId` 是被拖块的后代 → `return false`（`isDescendantOf`，`src/utils/block-helpers.ts`） |
| 落位 | `applyDropTarget` | 目标父级 / `beforeId` 落在被拖块子树内 → 拒绝（纯函数层兜底，不依赖 DOM 状态） |

---

## 9. 指示器

- 模块级共享 ref（`sharedIndicatorStyle` / `sharedIndicatorClass` / `sharedIndicatorVisible`）：全应用只有一个 `<BlockDropIndicator>`，由 `BlockList` 经 `useSharedDropIndicator()` 渲染（`position: fixed`，`z-index: var(--z-sidebar)`）。
- 几何基准是目标块的 `.block-row` 矩形（`readRowRect`）。三种指示器各锚定一个内容列，全部以 **bullet 为基准**、用一级缩进量表达层级关系：

| 指示器 | 形态 | 水平位置 | 垂直位置 |
|---|---|---|---|
| `sort` | 2px 横线 | `bullet.left`（本行内容列），宽度铺到 `row.right` | `row.top`（before）/ `row.bottom`（after，即 `beforeId === null`） |
| `promote` | 2px 横线 | `bullet.left − INDENT_TOTAL_PER_LEVEL`（父级内容列） | `row.top` |
| `nest` | 竖线（1px 宽 + 2px `border-left`） | `bullet.left + INDENT_TOTAL_PER_LEVEL`（子级内容列） | `row.top` 起，高 = `row.height` |

- **`INDENT_TOTAL_PER_LEVEL = 44`**（`useBlockDragDrop.ts`）= `.block-children` 的 `padding-left`(20) + `Block/index.vue` 的 `INDENT_WIDTH_PER_LEVEL`(24)。改这两处必须同步此常量。
- ⚠️ **不要用目标块的 `depth` 参与缩进计算**：bullet 的 x 已经包含行内 `.block-indent` 的累计缩进（实测每级位移 44px：570 → 614 → 658 → 702），再乘层级会把缩进算两遍。所以「给 `.block` 加 `data-depth`」是错的方向 —— 代码里**刻意没有**这个属性。
- 旧实现以 bullet 的 20px 矩形为基准：`sort` / `promote` 横线只有 20px 长，`nest` 宽度被 clamp 到 1px，`nest` 缩进按 `24 * (depth + 1)` 计算（`data-depth` 缺失 → 恒按 depth 0 算，凑巧少算 20px）。
- 无效、越界（bullet 无尺寸 / 行无高度 / 行滚出视口）的目标一律 `clearIndicator()`。

---

## 10. 已知缺口

1. **【已于 2026-09-11 修复】指示器几何不准 + 中区不可达**：水平基准曾用 20px 的 bullet 矩形 → 中区为空集（`sort-after` 无独立手势）、`sort`/`promote` 横线只有 20px、`nest` 线宽被 clamp 到 1px；`nest` 还按 `24 * (depth + 1)` 算缩进（`.block` 上没有 `data-depth`，恒按 0 算）。修法：基准换成 `.block-row`，缩进改为常量 `INDENT_TOTAL_PER_LEVEL = 44`，**不引入 `data-depth`**（引入反而把缩进算两遍，见 §9）。对照回归用例：`useBlockDragDrop.test.ts` 的「真实 20px bullet 下中区为空集，改用行矩形基准后中区可达」。
2. **【未修，高危】跨容器拖拽会拆散子树**：把带子块的块从子容器拖到**根容器**后，它的二级子块被提升为根级（实测：`CC` 带子块 `AA` 从 `BBB` 的子容器拖到根容器 → `AA.parent_id` 由 `CC` 变成 `null`）。**同容器内 sort 不触发**（对照实验通过）。同一次拖拽后还观察到 DOM 内容错位（`AA` 重复 3 次、被拖块消失），reload 后由数据重建才恢复。疑因嵌套 Sortable 列表未声明 item 选择器（`closest` 可能命中嵌套子块）或 v-model 的 `onRemove`/`onAdd` 索引按 DOM 计算，需进一步确认。**在修好之前，跨容器拖拽的回归必须以「reload 后比对 IPC 数据」为准，不要相信拖拽后的即时 DOM。**
3. **`@move` 只在块间移动时触发**（§4.3）：同一块内横向微调不刷新指示器 —— 想从 `sort` 切到 `nest` 必须把指针移到另一块再回来。因为判定基准换成整行后三区都在同一行内，这条的影响比之前更明显（横向移动量变大）。
4. **【已于 2026-09-11 修复】`parent_id` 曾无法写回 NULL**：`BlockService::update` 的 `parent_id: Option<&str>` 中 `None` 意为「不修改」，而 `save_blocks` 直接透传 `block.parent_id.as_deref()`，于是「拖回根级」的 `null` 被静默忽略（`version` 照样自增）→ reload 后回到原父级。修法：`save_blocks` 在 `update` 之后比对 `updated.parent_id != block.parent_id`，不一致时调新增的 `BlockService::set_parent_id` 显式写回（含 NULL）。回归测试：`block_write.rs::save_blocks_clears_parent_id_back_to_root`。
5. **文档与测试**：`docs/sort/phase-1-1-plan.md` / `phase-1-1-dev.md` 描述的是 v0.2 方案，已在文首标注「已作废」。单测覆盖 `resolveDropAction` / `applyDropTarget` 两个纯函数与 `handleBlockDragEnd` 的意图判据（`useBlockDragDrop.test.ts`）；真机回归靠 tauri-mcp，混合法：`execute_js` 派发**带时间间隔**的 `PointerEvent` 序列（无间隔则 Sortable 的 `setInterval(_emulateDragOver, 50)` 无机会跑），再用 `dispatch_pointer(gesture='up')` 收尾。注意拖拽中布局持续变化（源元素被 Sortable 重排），**终点坐标必须在拖拽进行中重新测量**。

---

## 11. 历史（v0.2，已作废）

v0.2（2026-04-29，状态「已实现」）的内容已被取代，**不要再参照**：

| v0.2 内容 | 现状 |
|---|---|
| `src/composables/useSortable.ts` | **文件已删除**，接线收敛到 `BlockDraggableList.vue` |
| `blocks.ts: moveBlock()` | **已删除**，落库改走 `syncTreeToStore` 完整树 diff |
| `safeCalcInsertPos()` 中间值插入 | 已删除，改由 `syncTreeToStore` 重发连续 pos |
| `group: 'blocks'`（全局同名 group） | 现为 `'blocks-' + pageId` |
| `handle: '.block-bullet'` | 现为 `.bullet-dot`（chevron 走 `filter`） |
| `onEnd` 内 `await moveBlock` + 失败回滚 DOM | 已无增量写路径，故无回滚逻辑；落库是纯数据操作 |
| Editor.vue 根容器接 Sortable | 根级接线现在 `BlockList.vue` |
| 每个 `.block-children` 各自持有一个 Sortable 实例 | 改为组件化 `<BlockDraggableList>`，VueDraggable 自管实例 |

原 v0.2 遗留的「指示线与实际放置位置不一致」问题，现由 §6 的 `applyDropTarget` 兜底。

---

## 12. 相关文档

| 文档 | 说明 |
|------|------|
| [`../1-overview/SPEC.md`](../1-overview/SPEC.md) | 项目总规范（核心约束） |
| [`../3-features/block-editor-spec.md`](../3-features/block-editor-spec.md) | 编辑器架构规范 |
| [`../3-features/block-ordering-redesign.md`](../3-features/block-ordering-redesign.md) | 块排序重构 |
| `CONTEXT.md`（仓库根） | 单一上下文领域文档 |
| `docs/adr/` | 架构决策记录 |
