import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './blocks'
import { useFieldValueStore } from './fieldValue'
import type { FieldValue } from '../types/field-value'

/**
 * reconcileCollapse 的「仅字段块」契约（ADR-0045 D2 扩展）。
 *
 * 折叠范围 = 子树 + 字段带（见 useBlockCollapse）。因此「有字段行、无子块」的块
 * 仍是可折叠块，子块被删空**不构成**复位理由 —— 读取侧守卫（`canCollapse`）已是
 * 「有子块 或 有字段行」双条件，写入侧复位（`reconcileCollapse`）必须同口径，
 * 本文件是这条对称性的回归网（2026-10-12 补齐写入侧判据，三例全绿）。
 *
 * ⚠️ 可达性（2026-10-12 核查）：**当前没有 UI 路径能触发**。折叠块的子树是
 * `display:none`，删除 / 缩进 / 反缩进 / 拖拽都要求被操作块可见；而它可见 ⇒ 其父块
 * 未折叠 ⇒ `collapsed === true` 不成立。唯一能选中隐藏块的 Ctrl+A 又必然连祖先一起
 * 选中，被 `!toDelete.has(parentId)` 挡掉。故本文件是**防御性契约**：一旦新增
 * 「能删折叠块子块」的入口（跨视图删除 / 折叠块批量清子块 / 自动化规则），立刻生效。
 */

beforeEach(() => {
  setActivePinia(createPinia())
})

/** 给块种一行字段值（代表「字段带里有可渲染的行」）。 */
function seedFieldRow(blockId: string, key = 'note'): void {
  const fv = useFieldValueStore()
  const row: FieldValue = {
    id: `fv-${blockId}-${key}`,
    block_id: blockId,
    field_definition_id: `fd-${key}`,
    key,
    value_json: '"x"',
    value_type: 'string',
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 1,
    deleted_at: null,
  }
  const map = new Map(fv.fieldValuesByBlock)
  map.set(blockId, [row])
  fv.fieldValuesByBlock = map
}

describe('reconcileCollapse — 仅字段块的折叠态保活', () => {
  test('删除唯一子块后，有字段行的块保持折叠（字段带仍需被藏住）', async () => {
    const store = useBlockStore()
    const pageId = 'page-collapse-field'
    const parent = await store.createBlock({ pageId, content: '' })
    const child = await store.createBlock({ pageId, content: 'C', parentId: parent.id })

    seedFieldRow(parent.id)
    await store.updateBlockFormat(parent.id, { collapsed: true })
    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(true)

    await store.deleteBlocks([child.id])

    // 契约：字段行仍在 ⇒ 块仍可折叠 ⇒ 折叠标志必须保活。
    // （可达性见文件头 ⚠️：当前 UI 打不到这条，属防御性契约。）
    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(true)
  })

  test('护栏：子树只减半时照旧保持折叠（判据是「且」，不是「或」）', async () => {
    const store = useBlockStore()
    const pageId = 'page-collapse-partial'
    const parent = await store.createBlock({ pageId, content: '' })
    const c1 = await store.createBlock({ pageId, content: 'C1', parentId: parent.id })
    await store.createBlock({ pageId, content: 'C2', parentId: parent.id })

    await store.updateBlockFormat(parent.id, { collapsed: true })
    await store.deleteBlocks([c1.id])

    // 还有子块 ⇒ 不在复位候选内。这条挡住把双条件写成「或」的糊弄修法。
    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(true)
  })

  test('反向锚点：无子块且无字段行时，stale 折叠标志照旧被复位', async () => {
    const store = useBlockStore()
    const pageId = 'page-collapse-stale'
    const parent = await store.createBlock({ pageId, content: '' })
    const child = await store.createBlock({ pageId, content: 'C', parentId: parent.id })

    await store.updateBlockFormat(parent.id, { collapsed: true })
    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(true)

    await store.deleteBlocks([child.id])

    // 真 stale（既无子块也无字段）仍须复位——修法不得破坏这条原语义。
    expect(store.getBlock(parent.id)?.format?.collapsed).toBe(false)
  })
})
