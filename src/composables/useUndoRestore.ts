/**
 * useUndoRestore —— ADR-0046 T3（#108）：快照恢复 diff + 落库。
 *
 * 给定目标快照（来自 useUndoHistory 的 undo/redo 返回的 HistoryEntry），计算
 * 「当前 store 状态 vs 目标快照」的差异，并一次性落库：
 *  - 目标有、当前无（被软删）  → 精确 undelete op 复活（在 executeBatch 事务内）+ block update 还原字段
 *                              + 该块属性**无条件**重设（删除级联软删了属性行，见 reviveProps）
 *  - 目标有、当前有但不同      → block update
 *  - 当前有、目标无            → block delete（batch，级联清理 link + property）
 *  - 属性：按 key 对齐         → property set / delete（并入同一批；复活块除外，见上）
 *
 * 落库：全部操作（含 undelete）并入**单次** executeBatch（#108 验收#2，对齐
 * blocks.ts:1338 的 deleteBlocks 范式），整批一个事务、任一 op 失败整批回滚。
 * undelete 不再是独立 RPC —— 精确复活「当前软删、且明确列于快照」的块（不级联），
 * 故不会产生「复活但不属于目标」的 stray，也消除了「undelete 成功而 batch 失败
 * 留下半恢复」的窗口（#103 审查 (a)2）。任一步失败 → 回滚 reactive 状态。
 *
 * 否决项（ADR-0046 约束1/2）：
 *  - 已删块走 undelete（清 deleted_at），绝不按原 id 重插（撞 PK，约束1）。
 *  - link 行不进快照、由 Rust 端 execute_batch 的 block delete / save 路径重建，
 *    前端无需处理（约束2）。
 */
import { nextTick } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { CoreClient } from '../wasm/client'
import type { BatchOperation } from '../wasm/types'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { usePropertyStore } from '../stores/property'
import type { Block } from '../types/block'
import type { Property } from '../types/property'
import type { HistoryEntry } from './useUndoHistory'
import { blockDocumentEqual, canRedo, canUndo, commitNow, redo, undo } from './useUndoHistory'
import { encodePropertyValue } from '../utils/property-codec'

let clientPromise: Promise<CoreClient> | null = null
async function getClient(): Promise<CoreClient> {
  if (!clientPromise) clientPromise = initCoreClient()
  const client = await clientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

function propValueEqual(a: Property, b: Property): boolean {
  return a.type === b.type && JSON.stringify(a.value) === JSON.stringify(b.value)
}

function blockUpdateOp(b: Block): BatchOperation {
  return {
    entity: 'block',
    action: 'update',
    params: {
      id: b.id,
      page_id: b.pageId,
      parent_id: b.parentId,
      pos: b.pos,
      content: b.content,
      format: JSON.stringify(b.format || {}),
      type: b.type,
    },
  }
}

function propSetOp(p: Property): BatchOperation {
  return {
    entity: 'property',
    action: 'set',
    params: {
      id: p.id,
      block_id: p.blockId,
      key: p.key,
      value: encodePropertyValue(p.value, p.type),
      type: p.type,
      sort_order: p.sortOrder,
      is_hidden: p.isHidden ? 1 : 0,
    },
  }
}

function propDeleteOp(p: Property): BatchOperation {
  return { entity: 'property', action: 'delete', params: { id: p.id } }
}

/**
 * 复活块的属性必须**无条件重设**，不走 alignProps 的相等短路。
 *
 * 成因：Rust 侧删块时级联软删其属性行（`delete_block_cascade` →
 * `PropertyService::delete_by_block_id`，见 `entity/property.rs`），而 T1 的
 * `undelete_blocks` 只复活块行 —— 派生数据明确不在其范围内（`block_write.rs`
 * `undelete_block_subtree_inner` 的 Scope 注）。「块行复活 + 属性行复活」的对称性
 * 由本处的 `property set` 承担：`property_upsert` 的 `ON CONFLICT(block_id, key)`
 * 会把 `deleted_at` 清回 NULL，即同一条属性行原地复活（不撞 PK）。
 *
 * 为什么不复用 alignProps：它的相等判定以「客户端属性缓存 = DB 现状」为前提，而
 * `deleteBlocks` 只从 store 移块、**不清理 propertyStore** —— 删除后缓存里仍是旧值，
 * 对复活块而言缓存与 DB 已经脱节，「目标 == 缓存」不再蕴含「DB 行仍 live」。
 * 2026-09-15 真机实证：块 undelete 复活（updated_at 1789433521627）比其属性行的
 * deleted_at（1789433518288）晚 3.3s，恢复批次里一个 property op 都没有。
 */
function reviveProps(targetProps: Property[], propOps: BatchOperation[]): boolean {
  for (const tp of targetProps) propOps.push(propSetOp(tp))
  return targetProps.length > 0
}

/**
 * 按 key 对齐某块的属性：目标有而当前无 / 值不同 → set；当前有而目标无 → delete。
 * 生成的操作 push 进 propOps；返回**是否产生了任何属性操作**（供调用方判定该块是否受影响，
 * 不再靠 propOps 长度差这种隐式协议）。
 */
function alignProps(
  blockId: string,
  targetProps: Property[],
  propertyStore: ReturnType<typeof usePropertyStore>,
  propOps: BatchOperation[],
): boolean {
  // Pinia store 代理已解包 ref：propertiesByBlock 直接当 Map 用（与 useUndoHistory 同口径）
  const currentProps = propertyStore.propertiesByBlock.get(blockId) ?? []
  const currentByKey = new Map(currentProps.map((p) => [p.key, p]))
  const targetByKey = new Map(targetProps.map((p) => [p.key, p]))

  const before = propOps.length
  for (const tp of targetProps) {
    const cp = currentByKey.get(tp.key)
    if (!cp || !propValueEqual(cp, tp)) propOps.push(propSetOp(tp))
  }
  for (const cp of currentProps) {
    if (!targetByKey.has(cp.key)) propOps.push(propDeleteOp(cp))
  }
  return propOps.length > before
}

/**
 * 将目标快照应用到指定页：diff 当前 store 状态，构建批量操作并一次性落库。
 * 乐观更新 reactive 状态（与 deleteBlocks 一致：先改 UI 再 RPC），任一步失败回滚。
 *
 * 返回**受影响块 id**（正文/结构变化、被复活、被软删、属性被对齐的块并集）——
 * 供键盘接管的撤销落点使用（#109：受影响块置为块选区 + 滚入视野）。顺序不作保证；
 * 调用方须自行过滤已不在 store 中的 id（被软删的块）。
 */
export async function restoreEntry(pageId: string, snapshot: HistoryEntry): Promise<string[]> {
  const blockStore = useBlockStore()
  const propertyStore = usePropertyStore()

  const currentBlocks = blockStore.getBlocksByPage(pageId)
  const currentById = new Map(currentBlocks.map((b) => [b.id, b]))
  const targetById = new Map(snapshot.blocks.map((b) => [b.id, b]))

  // 回滚快照（浅拷贝：逐块 `{...b}`，块内字段不深拷）——安全性依赖「恢复路径
  // 不嵌套 mutate 块内字段」的约定：format 整体替换、属性在独立 store（#118 F3 勘误）。
  // 真正回滚 = 把这组副本赋回 store（见 catch），对象身份整体替换 → 结构签名变化
  // → BlockList 自动重建树，无需任何 bump（#118 D2）。
  const rollbackBlocks = blockStore.blocks.map((b) => ({ ...b }))
  const rollbackProps = new Map(
    [...propertyStore.propertiesByBlock.entries()].map(([k, v]) => [k, v.map((p) => ({ ...p }))]),
  )

  // ---- diff ----
  const affected = new Set<string>()
  const revivedIds: string[] = []
  const blockUpdateOps: BatchOperation[] = []
  const blockDeleteOps: BatchOperation[] = []
  const propOps: BatchOperation[] = []

  for (const target of snapshot.blocks) {
    const current = currentById.get(target.id)
    const targetProps = snapshot.properties[target.id] ?? []
    if (!current) {
      // 被软删 → 复活（清 deleted_at）+ 还原字段
      revivedIds.push(target.id)
      blockUpdateOps.push(blockUpdateOp(target))
      affected.add(target.id)
      // 属性行一并复活（级联软删的对称恢复，见 reviveProps 注）
      if (reviveProps(targetProps, propOps)) affected.add(target.id)
    } else {
      // 块字段 diff（#113）：从信封真源派生（useUndoHistory.blockDocumentEqual），
      // 不再手工枚举字段清单——新增文档态字段改 documentState 一处即自动进 diff。
      if (!blockDocumentEqual(current, target)) {
        blockUpdateOps.push(blockUpdateOp(target))
        affected.add(target.id)
      }
      // 属性对齐（无论块是否变化，目标快照里该块的属性即为期望态）
      if (alignProps(target.id, targetProps, propertyStore, propOps)) {
        affected.add(target.id)
      }
    }
  }

  for (const current of currentBlocks) {
    if (!targetById.has(current.id)) {
      blockDeleteOps.push({ entity: 'block', action: 'delete', params: { id: current.id } })
      affected.add(current.id)
    }
  }

  // ---- 乐观更新 reactive 状态（使 UI 立即反映快照）----
  // 整页换新对象：数组与对象身份都变化 → 结构签名（#118 D2）必变 → BlockList 自动重建树。
  // （旧实现须手动 bump structureVersion，见 #103 T1：不触发则复活块滞留 store 不进 DOM。）
  blockStore.blocks = [
    ...blockStore.blocks.filter((b) => b.pageId !== pageId),
    ...snapshot.blocks.map((b) => ({ ...b })),
  ]

  const nextProps = new Map(propertyStore.propertiesByBlock)
  for (const target of snapshot.blocks) {
    nextProps.set(
      target.id,
      (snapshot.properties[target.id] ?? []).map((p) => ({ ...p })),
    )
  }
  for (const current of currentBlocks) {
    if (!targetById.has(current.id)) nextProps.delete(current.id)
  }
  propertyStore.propertiesByBlock = nextProps

  // ---- 落库：undelete 作为 op 并入单次 executeBatch（单一事务）----
  // 精确复活「当前软删、且明确列于快照」的块（不级联，故不产生 stray）。undelete op
  // 排在 update/delete/prop 之前，保证「先复活、再还原字段」在同一事务内顺序生效。
  const undeleteOps: BatchOperation[] = revivedIds.map(
    (id): BatchOperation => ({ entity: 'block', action: 'undelete', params: { id } }),
  )
  const operations: BatchOperation[] = [
    ...undeleteOps,
    ...blockUpdateOps,
    ...blockDeleteOps,
    ...propOps,
  ]
  try {
    const client = await getClient()
    if (operations.length > 0) {
      await client.executeBatch(operations)
    }
  } catch (error) {
    // 回滚 reactive 状态：赋回回滚快照 = 对象身份整体替换 → 结构签名（#118 D2）变化
    // → BlockList 自动重建树，回滚在 UI 层即时生效，无需 bump。
    blockStore.blocks = rollbackBlocks
    propertyStore.propertiesByBlock = rollbackProps
    console.error('[restoreEntry] commit failed, rolled back reactive state:', error)
    throw error
  }

  // Spec #5：恢复后重读 render_segments（只读、best-effort），修复 typed_link/date_ref
  // 内联标记退化。失败不影响已提交的恢复（回滚只覆盖 undelete+executeBatch）。
  await refreshRenderSegments(pageId)

  return [...affected]
}

/**
 * Spec #5：快照 slim 化时剔除 renderSegments（D11），恢复写回 store 的块 renderSegments
 * =undefined → BulletRender 落空 segments 兜底纯文本，typed_link/date_ref 内联标记退化直到
 * 重载/再保存。此处重读该页 render_segments（Rust 只读构建、不 bump version），按 id 写回。
 * WASM / 旧二进制无 get_page_with_blocks → 静默跳过（退化与 loadPageBlocks 回退路径一致）。
 */
async function refreshRenderSegments(pageId: string): Promise<void> {
  try {
    const client = await getClient()
    const pw = await client.getPageWithBlocks(pageId)
    if (!pw || !Array.isArray(pw.blocks) || pw.blocks.length === 0) return
    const segByBlock = new Map(pw.blocks.map((brd) => [brd.block.id, brd.render_segments]))
    if (segByBlock.size === 0) return
    const blockStore = useBlockStore()
    // 原地写 renderSegments，禁止整页替换对象：树（BlockList.tree）持有块对象引用，
    // 本函数定位为只读重取，若用 `blocks.map(b => ({ ...b, renderSegments }))`
    // 换新对象，结构签名（#118 D2）会因对象身份变化而触发不必要的整树重建，且
    // 树重建时机与后续 updateBlockContent 的原地 mutate 交错是 #109「只盖一行」
    // 一族的竞态温床；原地写则内容经深响应直达读态渲染，树与 store 永不分叉。
    // （历史注：计数器时代「换对象又不 bump」曾致「撤销后打字，失活即消失」，真机实证。）
    for (const b of blockStore.blocks) {
      if (b.pageId !== pageId) continue
      const segs = segByBlock.get(b.id)
      if (segs) b.renderSegments = segs
    }
  } catch {
    // 只读重取失败不影响已提交的恢复
  }
}

/** 撤销并恢复：移动游标到目标快照并返回受影响块 id；无可撤返回 null */
export async function undoAndRestore(pageId: string): Promise<string[] | null> {
  const snap = undo(pageId)
  if (!snap) return null
  return restoreEntry(pageId, snap)
}

/** 重做并恢复：移动游标到目标快照并返回受影响块 id；无可重做返回 null */
export async function redoAndRestore(pageId: string): Promise<string[] | null> {
  const snap = redo(pageId)
  if (!snap) return null
  return restoreEntry(pageId, snap)
}

/**
 * 撤销/重做编排（共享收口，供 BlockList 与 App 级全局兜底共用）：
 * 封口 → **判定有无这一步可走**（无可走即纯 no-op）→ 退出编辑态 → 再封口 → 移动游标并恢复。
 * 返回受影响块 id（无可撤/可重做返回 null）。
 *
 * no-op 守卫（#122）：空历史下按 Ctrl+Z 必须**什么都不发生** —— 原先先 deactivateBlock()
 * 再判空，栈空时会把正在编辑的块踢出编辑态（光标丢失）却什么也没撤。故判定前移到最前面：
 * 先 commitNow 把「已进 store 但未成步」的改动变成一步（commitNow 只动历史栈、不动激活态），
 * 再问 canUndo/canRedo。
 *
 * 已知边界（有意接受）：编辑器文本经 300ms 防抖才进 store，故「页面刚载入 → 首次输入后
 * 300ms 内」按 Ctrl+Z 会因 store 仍是旧内容而判为空、本次无反应（再按一次即生效）。
 * 与之交换的是「空历史不再打掉编辑态」——后者每次都发生，前者只在半个防抖窗口内。
 *
 * 退出编辑态必须先于第二次封口：Editor 卸载时（onBeforeUnmount）把还停在 300ms 落库防抖里的
 * 文本同步进 store；不先同步就恢复，那段未落库文本随后落库会把刚撤掉的内容写回来（#109）。
 * 守卫只退「落在目标页」的编辑态 —— BlockModal 他页块的编辑态不连坐清掉（#109）。
 */
export async function runUndoOrRedo(
  pageId: string,
  chord: 'undo' | 'redo',
): Promise<string[] | null> {
  commitNow(pageId)
  if (!(chord === 'undo' ? canUndo(pageId) : canRedo(pageId))) return null

  const editorStore = useEditorStore()
  const blockStore = useBlockStore()
  const activeId = editorStore.activeBlockId
  if (activeId && blockStore.getBlock(activeId)?.pageId === pageId) {
    editorStore.deactivateBlock()
    await nextTick()
  }
  // 第二次封口：承接上一步卸载同步进 store 的文本（回声抑制保证无改动时不重复入栈）
  commitNow(pageId)
  return chord === 'undo' ? undoAndRestore(pageId) : redoAndRestore(pageId)
}
