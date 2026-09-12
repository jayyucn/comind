# Block 拖拽实现（vue-draggable-plus / Sortable.js）

> 版本：v0.5
> 日期：2026-09-12
> 状态：**现行实现**。v0.2 的 `useSortable` + `moveBlock` 增量写路径已于 2026-09-11 的拖拽重构中作废，差异见 §11。
> v0.5 修订：§5 放置判定对齐现行的「间隙 × 深度刻度」六格矩阵（`computeDepthDelta`，取代旧的行缘 15px 热区描述）；§10.2 跨容器拆散子树复验通过、标记已修复；§10.7/10.8 记录候选 3（指示器去单例化）与候选 4（单一编排层）的评估结论——均不采纳。

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
  └─ useBlockDragDrop.ts        放置判定 / 指示器 / @start @move @end 处理
       ├─ resolveDropAction     放置语义判定（纯函数）
       ├─ applyDropTarget       按意图校正树（纯函数）
       └─ handleDragStart       接管拖拽期 document 级 pointermove（意图数据源）

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
| `@start` | `onDragStart`（`editorStore.deactivateBlock()` + `handleDragStart`） | **必须接管**：`handleDragStart` 记录被拖元素并挂上 document 级 `pointermove` 监听 —— 落位意图的唯一数据源（§4.5） |
| `@move` | `handleDragMove` | 返回 `false` 可阻止 Sortable 承接；**只做循环嵌套守卫**，不再参与意图判定 |
| `@end` | `handleBlockDragEnd` | 回传意图并摘掉指针监听 |

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

`force-fallback: true` ⇒ Sortable 绑 pointer 事件而非 mouse，并起 `setInterval(_emulateDragOver, 50)` 轮询驱动 `_onDragOver`。可观察后果：

- `_emulateDragOver` 用**最后一次真实 pointermove 的坐标**（模块级 `touchEvt`）做 `elementFromPoint` —— 轮询本身不产生新坐标，指针不动时它只是反复对同一点做判定；
- `@move` 只在「悬停块变化」时触发 —— 同一块内微调不会重复触发，指示器因此只在块间移动时刷新。

### 4.4 fallback 下的 DOM 角色（名字反直觉，务必分清）

`_appendGhost`（`sortable.esm.js:1509`）做的事：

```js
ghostEl = dragEl.cloneNode(true)
toggleClass(ghostEl, options.ghostClass, false)    // 从克隆上【移除】block-ghost
toggleClass(ghostEl, options.fallbackClass, true)  // 加 sortable-fallback
toggleClass(ghostEl, options.dragClass, true)      // 加 block-drag
css(ghostEl, 'pointerEvents', 'none')              // ← 关键
css(ghostEl, 'position', 'fixed'); zIndex 100000
container.appendChild(ghostEl)                     // container = rootEl（本项未开 fallbackOnBody）
```

于是拖拽期容器里有**两个同 `data-block-id` 的元素**：

| 元素 | 类名 | 角色 | 是否在流内 | 是否可被 `elementFromPoint` 命中 |
|---|---|---|---|---|
| 真实被拖元素（`dragEl`） | `block-ghost` + `block-chosen` | **留在列表里的占位**，标记落点位置 | ✅ 在流内 | ✅（它就是指针下方那个） |
| 克隆（`ghostEl`） | `block-drag` + `sortable-fallback` | **跟随指针的浮层** | ❌ `position: fixed` | ❌（`pointer-events: none`） |

两个反直觉点，改拖拽代码时最容易被绕进去：

1. **`block-ghost` 不是浮层，是占位**；跟随指针的那个叫 `block-drag`。名字是 Sortable 的历史包袱。
2. **`elementFromPoint` 在指针处拿到的是被拖元素自己**（占位），不是克隆 —— 因为克隆被 `pointer-events: none` 排除了。这正是 §4.5 里「向下拖偏上一个」的物理前提。

推论（§9 指示线与 §6 不变式都依赖它）：**占位元素的当前位置 = 用户看到的落点**。所以指针压在占位元素上时，判定必须收敛为「不动」，否则会和用户看到的位置打架。

### 4.5 为什么 `@move` 不能当落位意图来源（「向下拖偏上一个」的根因）

`_onDragOver` 开头有 `if (dragEl.contains(evt.target) ...) return completed(false)`。结合 §4.4：

1. 指针向下移动，进入下一个块的上半区 → Sortable 决定换位 → **派发一次 `@move`**（此帧意图是对的）；
2. 换位的代价是：占位元素被挪到指针下方，于是**指针立刻压在被拖元素自己身上**；
3. 之后每一帧 `_onDragOver` 都在第 1 行 early-return，**再也不派发 `@move`**；
4. ⇒ 最后一次采样永远是第 1 步那次（「指针刚进目标上半区」），落位表现就是**比指针位置高一个槽位**。

向上拖为什么看着正常：向上拖时「刚进目标上半区」恰好等于用户想插到的位置，冻结值与正确答案相同。**这不是两个方向的差异，而是同一个冻结 bug 在一个方向上凑巧正确。**

修法（v0.4）：意图改由 document 级 `pointermove` 持续重算（`handleDragStart` 接管、`handleBlockDragEnd` 摘除），不再依赖 Sortable 的稀疏采样；`@move` 收窄为纯循环嵌套守卫。

---

## 5. 放置判定 —— `resolveDropAction`（纯函数）

**「间隙 × 深度刻度」六格矩阵**（2026-09-12 起现行，取代旧的「行左右缘 15px 热区」模型）：

- **Y 维（间隙）**：光标相对目标块 **bullet 垂直中线**分上/下半区 → `computeSortPosition`（`useDragDrop.ts`），决定 before / after；
- **X 维（深度）**：光标相对目标块 **bullet 左缘**按 `INDENT_TOTAL_PER_LEVEL`(44) 刻度量化为 −1/0/+1 → `computeDepthDelta`，锚点两侧各 ±22px（半刻度）为同级宽列；
- 根级行的 −1 列钳制为同级 `sort`（根级无可提升处）。

| | 左列 −1（`x ≤ bullet.left − 22`） | 中列 0（±22 内） | 右列 +1（`x ≥ bullet.left + 22`） |
|---|---|---|---|
| **上半区** | P 之前 / `promote` | T 之前 / `sort` | T 长子位 / `nest`（`beforeId = firstChildId`，无子则 null = 追加） |
| **下半区** | P 之后 / `promote` | T 之后 / `sort` | T 末尾子位 / `nest`（追加） |

其中 P = 目标的父块，promote 的 `beforeId` 取 `parentId`（上半）/ `parentNextSiblingId`（下半）。**真机取点必须钉在目标 bullet 左缘 ±22 内才能表达同级 sort**——把 x 放在行中部（offset ≫ +22）会判成 `nest`（2026-09-12 真机实测两次踩中）。

`readDropGeometry` 是模块内唯一接触 DOM 的入口（读 `data-block-id`、bullet rect、`rowRect`、父块/祖父块/后继兄弟的 id）；`findDropTarget` 只是它加 `resolveDropAction` 的适配层。

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

**意图来源**（v0.4）：`handleDocumentPointerMove`（document 级 `pointermove`）每次按指针位置重算并暂存 `pendingIntent` / `pendingDraggedId`，`@end` 消费一次后重置。指针位置未变则跳过重算（`pointermove` 可达每帧一次，而判定要读 `elementFromPoint` + 多个 `getBoundingClientRect`）。**不用 `@move` 采样**，理由见 §4.5。

指针落在被拖元素自己身上（§4.4 的占位元素）时，`resolveTargetBlock` 退回「同容器内离指针最近的兄弟块」。此时解出的 `beforeId` 往往就是被拖块自身 ⇒ `applyDropTarget` 返回 `false` ⇒ **Sortable 的落位原样保留**。这是一个刻意维持的不变式：

> 指针压在占位元素上 ⇒ 落位 = 占位元素所在位置 = 用户看到的位置。

`@end` 的判据是「`pendingIntent` 是否存在」，**不能用 `indicatorVisible`**：拖拽末段指针常落在无效位置，此时会 `clearIndicator()` 把线隐藏，但用户最后看到的那条线依然有效 —— 用它作判据会连带作废意图，表现为「明明看到 nest 线，落位却按 Sortable 自然结果」。`pendingIntent` 只在成功判定分支赋值、且每次 `@end` 后重置，不会跨次残留。

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
- **子节点跟随**：跨父级移动只改被拖块自己的 `parentId` / `pos`（后代的 `parentId` 指向被拖块，无需修改）。跨容器拖拽曾破坏过这一点（§10.2），2026-09-12 三条路径复验已不再复现。
- **`parent_id` 语义**：`BlockService::update` 的 `parent_id: None` 意为「不修改」，表达不了「移到根级」；`save_blocks` 以传入值为权威，在 `update` 之后用 `BlockService::set_parent_id` 补写不一致（含清空为 NULL）。改这块时勿把这一步当冗余删掉。
- **三处注入同源**：`BlockList.handleDragEnd`、`BlockModal` 的 `provide('onDragEnd')`、`Block/index.vue` 的透传 —— 终点都是 `syncTreeToStore`。
- **弹窗子树**：`BlockModal` 的树以弹窗根块为根，意图里的 `toParentId === rootId` 先归一化为 `null` 再交给 `applyDropTarget`。

---

## 8. 循环嵌套防护

| 层 | 位置 | 手段 |
|---|---|---|
| 拖拽中（Sortable 承接前） | `handleDragMove` | `toEl.dataset.parentId` 是被拖块的后代 → `return false`（`isDescendantOf`，`src/utils/block-helpers.ts`） |
| 拖拽中（意图计算） | `updateIntentFromPointer` | 目标容器落在被拖块子树内 → 本次不产生意图（`dropTarget = null`），指示器隐藏 |
| 落位 | `applyDropTarget` | 目标父级 / `beforeId` 落在被拖块子树内 → 拒绝（纯函数层兜底，不依赖 DOM 状态） |

「指针落在被拖块自身」不需要单独判断：§4.5 的 early-return 本就发生在 Sortable 内部，且 §6 的不变式会让意图自动收敛为「不动」。

---

## 9. 指示器

- 模块级共享 ref（`sharedIndicatorStyle` / `sharedIndicatorClass` / `sharedIndicatorVisible`）：全应用只有一个 `<BlockDropIndicator>`，由 `BlockList` 经 `useSharedDropIndicator()` 渲染（`position: fixed`，`z-index: var(--z-sidebar)`）。
- 几何基准是目标块的 `.block-row` 矩形（`readRowRect`）。三种指示器各锚定一个内容列，全部以 **bullet 为基准**、用一级缩进量表达层级关系：

| 指示器 | 形态 | 水平位置 | 垂直位置 |
|---|---|---|---|
| `sort` | 2px 横线 | `bullet.left`（本行内容列），宽度铺到 `row.right` | **锚点行（`beforeId`）的行顶**；无锚点（追加到末尾）→ 目标行底部 |
| `promote` | 2px 横线 | `bullet.left − INDENT_TOTAL_PER_LEVEL`（父级内容列） | `row.top` |
| `nest` | 竖线（1px 宽 + 2px `border-left`） | `bullet.left + INDENT_TOTAL_PER_LEVEL`（子级内容列） | `row.top` 起，高 = `row.height` |

- **`sort` 线的垂直位置必须按锚点行算，不能一律画在「指针下那个目标行」的顶部**（v0.4 修）：判定出的 `beforeId` 不一定是指针下那块 —— 中区下半区会指向目标的下一块，指针压在被拖元素上时会指向被拖元素自己。线画在目标行顶部就会比真实落位高一行（真机实测：向下拖到底时线停在 `EE` 之上，实际却落在 `EE` 之后）。`readAnchorRowRect` 在目标块所在容器的直接子块里找 `data-block-id === beforeId` 的那一行；跳过 `.block-drag`（§4.4 的浮层克隆），保留 `.block-ghost`（真实被拖元素 —— 它的槽位正是「插到自己之前」的落点）。

- **`INDENT_TOTAL_PER_LEVEL = 44`**（`useBlockDragDrop.ts`）= `.block-children` 的 `padding-left`(20) + `Block/index.vue` 的 `INDENT_WIDTH_PER_LEVEL`(24)。改这两处必须同步此常量。
- ⚠️ **不要用目标块的 `depth` 参与缩进计算**：bullet 的 x 已经包含行内 `.block-indent` 的累计缩进（实测每级位移 44px：570 → 614 → 658 → 702），再乘层级会把缩进算两遍。所以「给 `.block` 加 `data-depth`」是错的方向 —— 代码里**刻意没有**这个属性。
- 旧实现以 bullet 的 20px 矩形为基准：`sort` / `promote` 横线只有 20px 长，`nest` 宽度被 clamp 到 1px，`nest` 缩进按 `24 * (depth + 1)` 计算（`data-depth` 缺失 → 恒按 depth 0 算，凑巧少算 20px）。
- 无效、越界（bullet 无尺寸 / 行无高度 / 行滚出视口）的目标一律 `clearIndicator()`。

---

## 10. 已知缺口

1. **【已于 2026-09-11 修复】指示器几何不准 + 中区不可达**：水平基准曾用 20px 的 bullet 矩形 → 中区为空集（`sort-after` 无独立手势）、`sort`/`promote` 横线只有 20px、`nest` 线宽被 clamp 到 1px；`nest` 还按 `24 * (depth + 1)` 算缩进（`.block` 上没有 `data-depth`，恒按 0 算）。修法：基准换成 `.block-row`，缩进改为常量 `INDENT_TOTAL_PER_LEVEL = 44`，**不引入 `data-depth`**（引入反而把缩进算两遍，见 §9）。对照回归用例：`useBlockDragDrop.test.ts` 的「真实 20px bullet 下中区为空集，改用行矩形基准后中区可达」。
2. **【已修复，2026-09-12 复验通过】跨容器拖拽曾拆散子树**：历史现象是把带子块的块从子容器拖到根容器后，其子块被提升为根级（`AA.parent_id` 由 `CC` 变 `null`），且拖拽后即时 DOM 错位（`AA` 重复 3 次、被拖块消失）。2026-09-12 在测试页（`CC` 带两个子块，置于 `BBB` 子容器）复验三条跨容器路径：nest 进根级块（×2）、根级 sort（指针钉在目标 bullet ±22 内，落点 = EE 之前根级），三次落库后子块 `parent_id` 均保持指向被拖块，子树完整随迁，DOM 亦无错位。判定为已被落位策略重构（`efb7053` invert-swap + `8e83d30` 指示/占位重构）顺带修复；真机回归仍以「reload 后比对 IPC 数据」为准（§10.6）。
3. **【已于 2026-09-11 修复】「向下拖时落点偏上一个」**：根因是意图来自 Sortable 的 `@move` 稀疏采样，被拖元素换位后挡住指针 → `_onDragOver` early-return → 采样冻结在换位前那一帧（完整机理见 §4.5）。修法：意图改由 document 级 `pointermove` 持续重算。回归用例：`useBlockDragDrop.test.ts` 的 `指针压在被拖元素上（向下拖的回归）` 三条。真机双向验证（下拖 → `EE,DD`；上拖 → `DD,EE`）见 §10.6。
4. **【已于 2026-09-11 修复】`parent_id` 曾无法写回 NULL**：`BlockService::update` 的 `parent_id: Option<&str>` 中 `None` 意为「不修改」，而 `save_blocks` 直接透传 `block.parent_id.as_deref()`，于是「拖回根级」的 `null` 被静默忽略（`version` 照样自增）→ reload 后回到原父级。修法：`save_blocks` 在 `update` 之后比对 `updated.parent_id != block.parent_id`，不一致时调新增的 `BlockService::set_parent_id` 显式写回（含 NULL）。回归测试：`block_write.rs::save_blocks_clears_parent_id_back_to_root`。
5. **【已知，影响小】指针静止时指示线不会跟随 Sortable 自身的重排**：指示器只在 `pointermove` 时刷新，而 Sortable 的 `setInterval(_emulateDragOver, 50)` 会在指针不动时继续调整占位元素（带 200ms 动画）。所以「松手前一刻把指针停住、等动画跑完」的场景下，线可能停在旧位置（真机实测到 `top=470` vs 重排后的 `499`）。落位本身正确（意图按指针算、§6 不变式兜底），只是线的视觉位置会短暂不同步。要修的话得在意图重算之外再加一个 rAF/动画结束后的重锚。
6. **文档与测试**：`docs/sort/phase-1-1-plan.md` / `phase-1-1-dev.md` 描述的是 v0.2 方案，已在文首标注「已作废」。单测覆盖 `resolveDropAction` / `applyDropTarget` 两个纯函数与 `handleBlockDragEnd` 的意图判据（`useBlockDragDrop.test.ts`）。

   真机回归靠 tauri-mcp，混合法：`execute_js` 派发**带时间间隔**（`await sleep(130~150)`）的 `PointerEvent` 序列（无间隔则 `_emulateDragOver` 轮询无机会跑）→ 读 `.drop-indicator` 的 class/inline `top` 确认意图 → `dispatch_pointer(gesture='up')` 收尾。四个易踩的点：

   - `pointerdown` 必须派发在 `.bullet-dot` 上（`handle: '.bullet-dot'`，Sortable 的 `_onTapStart` 绑在容器上、靠冒泡命中）；后续 `pointermove` 派发到 `document`（`_onTouchMove` 挂 document）。
   - 拖拽中布局持续变化（占位元素被 Sortable 重排），**终点坐标必须在拖拽进行中重新测量**。
   - 收尾用 `dispatch_pointer(gesture='up')`；**它的落点会重定位到元素中心**，所以别拿它当落点判据。更稳的做法是 `selector_value='.block-drag'`（浮层克隆就在指针处），坐标与指针一致。
   - **落位判据只看 IPC**：`navigate(reload)` 后 `manage_ipc invoke get_blocks_by_page` 比对 `parent_id` / `pos`。拖拽后的即时 DOM 不可信（§10.2）。

7. **【已评估，不采纳，2026-09-12】指示器状态去单例化**（原候选 3）：曾提议把模块级 `sharedIndicator*` 改为 provide/inject 作用域，避免多实例（KeepAlive 缓存 / 弹窗）抢占同一指示器。评估结论：**模块级单例在「同一时刻只有一次拖拽、指示器只该有一条」的前提下是正确语义而非缺陷**；#82 的真正教训（缓存实例的 document 监听双处理）已被现有防线覆盖——pointermove 监听只在拖拽期挂载（`@start` 接 / `@end` 摘）+ `onBeforeUnmount(stopPointerTracking)` 兜底，残留风险仅剩「拖拽中途组件被卸载」的极端路径。重写要动全部挂载点的接线，成本 > 防回归收益。**触发重估的条件**：真机出现指示器串页 / 双指示器 / 缓存实例残留指示器的实际 bug。
8. **【已评估，不采纳，2026-09-12】单一 useBlockDrag 编排层**（原候选 4）：曾提议收敛散落 7 文件的拖拽关注点。评估结论：「7 文件」中真正含拖拽逻辑的只有 3 个（`useBlockDragDrop.ts` 判定/意图、`BlockDraggableList.vue` Sortable 接线、`BlockModal.vue` 意图消费），其余是渲染组件（`BlockDropIndicator`）、集成点（`BlockList` / `Block/index.vue` 的 provide/inject）与数据层（`syncTreeToStore` / stores），且「单一写路径」刚在候选 5/6 收敛完成、职责清晰。再加一层编排等于推翻刚稳定的架构，风险 > 收益。另：早期 grep 命中的 `NamedViewBar` / `FieldManagerPanel` / `SortMenu` 是 "sort" 菜单的误匹配，与拖拽无关。

   2026-09-11 的实测记录（页面 `70fd4424…`，根级最后两块 `DD` / `EE`）：

   | 手势 | 指针落点 | 落库结果 |
   |---|---|---|
   | 下拖 `DD`（在 `EE` 之上 → 拖到 `EE` 行下半区） | (930, 521) | `EE(4000) / DD(5000)` ✅ 落在 `EE` 之后 |
   | 上拖 `DD`（在 `EE` 之下 → 拖到 `EE` 行上半区） | (930, 471) | `DD(4000) / EE(5000)` ✅ 回到 `EE` 之前 |

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
