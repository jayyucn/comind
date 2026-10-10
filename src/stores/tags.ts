import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { CoreClient } from '../wasm/client'
import type {
  PersistedTag,
  PersistedTagTreeEntry,
  PersistedFieldDefinition,
  CreateTagParams,
  UpdateTagParams,
  UpdateFieldDefinitionParams,
} from '../types/tag-persisted'
import type { BlockCard } from '../wasm/types'
import { useBlockStore } from './blocks'
import { useBlockCardStore } from './blockCard'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) {
    throw new Error('Core client not initialized')
  }
  return client
}

/**
 * 成员统计口径（ADR-0050 D10）：
 * - `direct` = 直系成员（块直接挂该 tag）—— 标签管理页口径；
 * - `aggregate` = 自身 + 后代闭包成员（向上聚合）—— tag 聚合页与过滤口径。
 */
export type MemberMode = 'direct' | 'aggregate'

/**
 * Tag 域读模型（ADR-0049 D6 落库持久化形；ADR-0050 D10 单父 + 解析式继承）。
 *
 * - **读**：数据源 = Rust `tag tree` 读接口（`entries`）——每行带解析后的
 *   `effective_field_ids`（自身 > 直接父 > 更近祖先）与 `descendant_ids`（后代闭包）。
 *   **解析单源在 Rust，本 store 只消费，不得重实现**（否则双源漂移）。
 *   字段定义（`fieldDefinitions`）同批拉取，供字段模板行与聚合页列取标题/类型。
 * - **写**：create / delete / setParent / 字段模板增删。写后整体重读，避免本地合并漂移。
 *   打标入口仍唯一走 content `#名`（Rust 侧 content 派生写 `Block.tags`），本 store 不改标签归属。
 * - **成员派生**（直系数 / 来源页数 / 最近使用 / 未使用）：投影自 `blockCardStore.cards`，
 *   零新列。调用方须先让 blockCard 投影就绪（`await blockCardStore.getCards()`）。
 * - 悬空引用保留（软删不销毁数据，undo 可完整还原；读侧解析时自然过滤）。
 */
export const useTagsStore = defineStore('tags', () => {
  // State
  const entries = ref<PersistedTagTreeEntry[]>([])
  const fieldDefinitions = ref<PersistedFieldDefinition[]>([])
  /** 被软删的预设字段定义（仅用于「恢复内置预设」按钮可见性判断） */
  const deletedPresetFieldDefinitions = ref<PersistedFieldDefinition[]>([])
  const loaded = ref(false)
  const loading = ref(false)

  // Getters
  /**
   * 原始行投影（单源是 `entries`，避免两处数据分叉）。
   *
   * ⚠️ 手工逐字段投影：给 `Tag` 加列时必须同步这里，否则新列会被静默丢弃
   * （`entries` 的行是 `PersistedTagTreeEntry`，比 `PersistedTag` 多两个解析字段）。
   */
  const tags = computed<PersistedTag[]>(() =>
    entries.value.map((e) => ({
      id: e.id,
      title: e.title,
      field_ids: e.field_ids,
      parent_id: e.parent_id,
      description: e.description,
      color: e.color,
      is_system: e.is_system,
      is_preset: e.is_preset,
      created_at: e.created_at,
      updated_at: e.updated_at,
      version: e.version,
      deleted_at: e.deleted_at,
    })),
  )

  /** 全部存活 tag（含系统 tag 行，用 is_system 区分）。 */
  const allTags = computed(() => tags.value.filter((t) => !t.deleted_at))

  /** 是否存在被软删的预设字段定义 —— 决定「恢复内置预设」按钮是否显示 */
  const hasDeletedPresets = computed(
    () => deletedPresetFieldDefinitions.value.length > 0,
  )

  // Actions

  /** 拉取标签树 + 字段定义（幂等：已加载则跳过；传 force 强制刷新）。 */
  async function ensureLoaded(force = false): Promise<PersistedTag[]> {
    if (loaded.value && !force) return tags.value
    if (loading.value) return tags.value
    loading.value = true
    try {
      const client = await getClient()
      const [tree, defs, deletedPresets] = await Promise.all([
        client.getTagTree(),
        client.getFieldDefinitions(),
        client.getDeletedPresetFieldDefinitions(),
      ])
      entries.value = tree
      fieldDefinitions.value = defs
      deletedPresetFieldDefinitions.value = deletedPresets
      loaded.value = true
    } finally {
      loading.value = false
    }
    return tags.value
  }

  function getTagById(id: string): PersistedTag | undefined {
    return tags.value.find((t) => t.id === id)
  }

  /** 标签树条目（含 Rust 侧解析出的有效字段 / 后代闭包）—— store 内部消费，不外露。 */
  function entryById(id: string): PersistedTagTreeEntry | undefined {
    return entries.value.find((e) => e.id === id)
  }

  function getFieldDefinition(id: string): PersistedFieldDefinition | undefined {
    return fieldDefinitions.value.find((d) => d.id === id)
  }

  // ── 继承与成员（读侧，解析结果来自 Rust） ────────────────────
  /** 有效字段集合（自身 > 直接父 > 更近祖先）。 */
  function effectiveFieldIds(tagId: string): string[] {
    return entryById(tagId)?.effective_field_ids ?? []
  }

  /** 有效字段定义（按有效顺序）；缺失定义静默跳过（悬空引用语义）。 */
  function effectiveFieldDefinitions(tagId: string): PersistedFieldDefinition[] {
    return effectiveFieldIds(tagId)
      .map((id) => getFieldDefinition(id))
      .filter((d): d is PersistedFieldDefinition => !!d)
  }

  /** 该 tag 自身声明的字段 id（未命中 → 空数组）。 */
  function ownFieldIds(tagId: string): string[] {
    return getTagById(tagId)?.field_ids ?? []
  }

  /** 命中集合 = 自身 + 后代闭包（聚合页与任务过滤用）。 */
  function memberTagIds(tagId: string): string[] {
    return [tagId, ...(entryById(tagId)?.descendant_ids ?? [])]
  }

  function parentTagOf(tagId: string): PersistedTag | undefined {
    const parentId = getTagById(tagId)?.parent_id
    return parentId ? getTagById(parentId) : undefined
  }

  /**
   * 有效字段的**来源标签**：沿父链上溯，找第一个「自身声明了该字段」的标签
   * （命中自身 → 返回自身；全链未声明 → undefined）。
   *
   * 注意：这是**归属查询**，不是优先级解析——「同名字段谁胜」的解析单源在 Rust
   * （`effective_field_ids`），此处只回答「这个 id 是谁声明的」，供 UI 打继承/自身徽标。
   */
  function fieldOrigin(tagId: string, fieldDefinitionId: string): PersistedTag | undefined {
    let cursor: string | undefined = tagId
    const visited = new Set<string>()
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor)
      const tag = getTagById(cursor)
      if (!tag) return undefined
      if (tag.field_ids.includes(fieldDefinitionId)) return tag
      cursor = tag.parent_id ?? undefined
    }
    return undefined
  }

  function childTags(tagId: string): PersistedTag[] {
    return allTags.value.filter((t) => t.parent_id === tagId)
  }

  /**
   * 可设为父的候选（排除自身与全部后代）—— 环守卫在 Rust 侧仍然生效，
   * 此处只为不给用户递上必然被拒的选项。
   */
  function parentCandidates(tagId: string): PersistedTag[] {
    const blocked = new Set(memberTagIds(tagId))
    return allTags.value.filter((t) => !blocked.has(t.id))
  }

  /**
   * 直系成员计数（单遍扫描 cards 投影，O(卡片数)）—— 列表 / 排序 / 统计的热路径缓存。
   * 逐标签调用 `memberCards` 是 O(标签数×卡片数)，标签树任何一行变化都会触发整页重算，
   * 选色这类轻写也会卡顿；这里一次算好，查表 O(1)。
   */
  const directMemberCount = computed<Map<string, number>>(() => {
    const map = new Map<string, number>()
    for (const c of useBlockCardStore().cards) {
      for (const t of new Set(c.tags ?? [])) {
        map.set(t, (map.get(t) ?? 0) + 1)
      }
    }
    return map
  })

  /** 直系成员最近使用时间（单遍扫描）：tag → 直系成员块 max(updated_at)；无成员 → 无键。 */
  const directLastUsedAt = computed<Map<string, number>>(() => {
    const map = new Map<string, number>()
    for (const c of useBlockCardStore().cards) {
      if (!c.updated_at) continue
      for (const t of new Set(c.tags ?? [])) {
        if (c.updated_at > (map.get(t) ?? 0)) map.set(t, c.updated_at)
      }
    }
    return map
  })

  /** 成员块投影（direct = 直系；aggregate = 自身 + 后代闭包）。 */
  function memberCards(tagId: string, mode: MemberMode = 'direct'): BlockCard[] {
    const ids = new Set(mode === 'direct' ? [tagId] : memberTagIds(tagId))
    return useBlockCardStore().cards.filter((c) =>
      (c.tags ?? []).some((t) => ids.has(t)),
    )
  }

  /** 成员数与来源页数（去重 page_id）—— 管理页 / 聚合页副标题共用。 */
  function memberSummary(
    tagId: string,
    mode: MemberMode = 'direct',
  ): { count: number; pageCount: number } {
    const cards = memberCards(tagId, mode)
    return {
      count: cards.length,
      pageCount: new Set(cards.map((c) => c.page_id)).size,
    }
  }

  /** 最近使用时间 = 直系成员块的 max(updated_at)；无成员 → 0。 */
  function lastUsedAt(tagId: string): number {
    return directLastUsedAt.value.get(tagId) ?? 0
  }

  /** 「最近使用」筛选用：按 lastUsedAt 降序（无成员的排最后）。 */
  function recentTags(): PersistedTag[] {
    return [...allTags.value].sort((a, b) => lastUsedAt(b.id) - lastUsedAt(a.id))
  }

  /** 「未使用」筛选用：直系成员数为 0。 */
  function unusedTags(): PersistedTag[] {
    return allTags.value.filter((t) => (directMemberCount.value.get(t.id) ?? 0) === 0)
  }

  /** 解析 block 已打的 tag（软删/不存在的 id 静默过滤 —— 悬空引用保留在 block.tags 上）。 */
  function blockTags(blockId: string): PersistedTag[] {
    const blockStore = useBlockStore()
    const block = blockStore.getBlock(blockId)
    return resolveTags(block?.tags ?? [])
  }

  /** 解析给定 tag id 列表（软删 / 悬空 id 静默过滤）。 */
  function resolveTags(ids: string[]): PersistedTag[] {
    return ids
      .map(id => getTagById(id))
      .filter((t): t is PersistedTag => !!t && !t.deleted_at)
  }

  /**
   * 批量复活被软删的预设字段定义（ADR-0049 三态模型：预设删后可恢复）。
   * 只复活 `is_preset=1` 且已软删的行，绝不覆盖活跃编辑。返回本次复活的条数。
   */
  async function restoreBuiltinPresets(): Promise<number> {
    const client = await getClient()
    const result = await client.restoreBuiltinPresets()
    await ensureLoaded(true)
    return result.restored
  }

  // ── 写（写后整体重读，避免本地合并漂移） ──────────────────────

  async function createTag(params: CreateTagParams): Promise<PersistedTag> {
    const client = await getClient()
    const created = await client.createTag(params)
    await ensureLoaded(true)
    return created
  }

  async function deleteTag(id: string): Promise<void> {
    const client = await getClient()
    await client.deleteTag(id)
    await ensureLoaded(true)
  }

  /** 设置单父（null = 清空回顶级）。成环 / 系统 tag 由 Rust 侧拒绝并抛出。 */
  async function setParent(id: string, parentId: string | null): Promise<PersistedTag> {
    const client = await getClient()
    const updated = await client.setTagParent({ id, parent_id: parentId })
    await ensureLoaded(true)
    return updated
  }

  /** 改写该 tag 自身的字段集合（继承不受影响）。 */
  async function setOwnFields(tagId: string, fieldIds: string[]): Promise<PersistedTag> {
    const client = await getClient()
    const params: UpdateTagParams = { id: tagId, field_ids: fieldIds }
    const updated = await client.updateTag(params)
    await ensureLoaded(true)
    return updated
  }

  /**
   * 设置标签身份（描述 / 颜色；ADR-0050 D11）。**只传要改的字段**；传空串表示清空 ——
   * 空串是**有效值**（未填写 / 无色），必须原样发出，不得按「未改」省略。
   *
   * 身份与模板的编辑面边界见 ADR-0050 D12：身份可多入口（管理页右栏 + 聚合页标题区），
   * 模板（字段模板 / 父标签）只在管理页右栏。
   */
  async function setIdentity(
    tagId: string,
    identity: { description?: string; color?: string },
  ): Promise<PersistedTag> {
    // 乐观更新：身份是单行标量（不涉及继承解析），先改本地让 UI 立即反馈，
    // 落库 + 整体重读在后台收口（整体重读仍是唯一真相，本地改动会被覆盖对齐）。
    const entry = entryById(tagId)
    const prev = entry ? { description: entry.description, color: entry.color } : null
    if (entry) {
      if (identity.description !== undefined) entry.description = identity.description
      if (identity.color !== undefined) entry.color = identity.color
    }
    try {
      const client = await getClient()
      const params: UpdateTagParams = { id: tagId }
      if (identity.description !== undefined) params.description = identity.description
      if (identity.color !== undefined) params.color = identity.color
      const updated = await client.updateTag(params)
      await ensureLoaded(true)
      return updated
    } catch (err) {
      // 写失败 → 回滚本地乐观值，避免 UI 与落库真相漂移
      if (entry && prev) {
        entry.description = prev.description
        entry.color = prev.color
      }
      throw err
    }
  }

  /**
   * 给标签添加字段：建 FieldDefinition（key 全局唯一）+ 追加进自身 field_ids。
   * key 只是存储标识，不进用户视野（用户看到的是 title / type）。
   */
  async function addFieldToTag(
    tagId: string,
    params: { title: string; type: string; closed_values?: string[] | null },
  ): Promise<void> {
    const client = await getClient()
    const tag = getTagById(tagId)
    if (!tag) throw new Error(`tag not found: ${tagId}`)
    const def = await client.createFieldDefinition({
      key: `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title: params.title,
      type: params.type,
      closed_values: params.closed_values ?? null,
    })
    await client.updateTag({ id: tagId, field_ids: [...tag.field_ids, def.id] })
    await ensureLoaded(true)
  }

  /**
   * 引用已有字段定义：把既有 FieldDefinition 声明进本标签（ADR-0050 D10 修订增补）。
   * 不新建定义；幂等（已声明直接返回）。定义全局共享 —— 引用方与首个声明方同权编辑。
   */
  async function referenceField(tagId: string, fieldDefinitionId: string): Promise<void> {
    const tag = getTagById(tagId)
    if (!tag) throw new Error(`tag not found: ${tagId}`)
    if (tag.field_ids.includes(fieldDefinitionId)) return
    await setOwnFields(tagId, [...tag.field_ids, fieldDefinitionId])
  }

  /**
   * 首个声明者：存活标签中 `created_at` 最早且 `field_ids` 含该定义者（created_at 相同
   * 按 id 兜底排序保证确定性）。来源列三态（ADR-0050 D10 修订增补 #4）用它判定
   * 「自身声明」与「引用←X」——不给 FieldDefinition 加 owner 列。
   */
  function firstDeclarerOf(fieldDefinitionId: string): PersistedTag | undefined {
    let best: PersistedTag | undefined
    for (const t of allTags.value) {
      if (!t.field_ids.includes(fieldDefinitionId)) continue
      if (
        !best ||
        t.created_at < best.created_at ||
        (t.created_at === best.created_at && t.id < best.id)
      ) {
        best = t
      }
    }
    return best
  }

  /**
   * 改写字段定义（标题 / 类型 / 候选值）。**只传要改的字段**；`closed_values` 显式传 null
   * 表示清空候选值（降为非选项型，用于「下拉选择 → 文本/数值」的降级）。
   *
   * 注意：定义是**全局共享**的（可被多个标签引用），改一处所有引用方同步生效 ——
   * 编辑权判据见 ADR-0050 D10 修订增补 #3：本标签已声明该定义（`field_ids` 含之）
   * 且定义非 `is_system` 即可就地编辑，引用方与首个声明方同权；继承行（未声明）只读。
   */
  async function updateFieldDefinition(params: UpdateFieldDefinitionParams): Promise<void> {
    const client = await getClient()
    await client.updateFieldDefinition(params)
    await ensureLoaded(true)
    // T6：spec 特化标记的持久化列尚未在 Rust 侧落地（本轮约定不动 Rust 迁移，
    // FieldDefinition 表亦无既有扩展 JSON 列可复用，见 T6 交付报告）——上面的整表
    // 重读会丢掉本次写入的 spec。这里把它回贴到本地条目，保证会话内特化选择、
    // 编辑器分派与展示不被抹掉；跨会话持久化待 Rust 加列后自然生效。
    if (params.spec !== undefined) {
      const row = fieldDefinitions.value.find((d) => d.id === params.id)
      if (row) row.spec = params.spec ?? undefined
    }
  }

  /**
   * 从标签移除字段：**只解除引用，不删 FieldDefinition**（定义可能被其他标签复用；
   * 删定义会级联清值，那是另一条路径，不在本操作语义内）。
   */
  async function removeFieldFromTag(tagId: string, fieldDefinitionId: string): Promise<void> {
    const tag = getTagById(tagId)
    if (!tag) throw new Error(`tag not found: ${tagId}`)
    await setOwnFields(tagId, tag.field_ids.filter((f) => f !== fieldDefinitionId))
  }

  return {
    entries,
    fieldDefinitions,
    deletedPresetFieldDefinitions,
    hasDeletedPresets,
    tags,
    loaded,
    loading,
    allTags,
    ensureLoaded,
    getTagById,
    getFieldDefinition,
    effectiveFieldIds,
    effectiveFieldDefinitions,
    ownFieldIds,
    memberTagIds,
    parentTagOf,
    fieldOrigin,
    firstDeclarerOf,
    childTags,
    parentCandidates,
    memberCards,
    memberSummary,
    directMemberCount,
    lastUsedAt,
    recentTags,
    unusedTags,
    blockTags,
    resolveTags,
    createTag,
    deleteTag,
    setParent,
    setOwnFields,
    setIdentity,
    addFieldToTag,
    referenceField,
    removeFieldFromTag,
    updateFieldDefinition,
    restoreBuiltinPresets,
  }
})
