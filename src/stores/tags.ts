import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { CoreClient } from '../wasm/client'
import type { PersistedTag } from '../types/tag-persisted'
import { useBlockStore } from './blocks'

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
 * Tag store（ADR-0049 D6 落库持久化形；2026-09-21 grill 定稿后只读）。
 *
 * - 数据源：SQLite Tag 表（经 batch `tag` op）。系统 tag 已全套落库（grill 决策 #5），
 *   与用户 tag 共表，用 `is_system` 区分；TS 常量形 SYSTEM_TAGS（src/types/tag.ts）
 *   仍承载展示层（图标/displayPosition 等），读侧解析双源。
 * - **打标入口 = content `#foo` 唯一**（grill 决策 #1）：Rust 侧 `BlockService::update`
 *   每次内容编辑重算派生集写入 Block.tags；本 store 无写 actions。
 * - 悬空引用保留（软删不销毁数据，undo 可完整还原；读侧解析时自然过滤）。
 */
export const useTagsStore = defineStore('tags', () => {
  // State
  const tags = ref<PersistedTag[]>([])
  const loaded = ref(false)
  const loading = ref(false)

  // Getters
  /** 全部存活（未软删）tag（含系统 tag 行，用 is_system 区分）。 */
  const userTags = computed(() => tags.value.filter(t => !t.deleted_at))

  // Actions

  /** 拉取全部 tag（幂等：已加载则跳过；传 force 强制刷新）。 */
  async function ensureLoaded(force = false): Promise<PersistedTag[]> {
    if (loaded.value && !force) return tags.value
    if (loading.value) return tags.value
    loading.value = true
    try {
      const client = await getClient()
      tags.value = await client.getTags()
      loaded.value = true
    } finally {
      loading.value = false
    }
    return tags.value
  }

  function getTagById(id: string): PersistedTag | undefined {
    return tags.value.find(t => t.id === id)
  }

  /** 解析 block 已打的 tag（软删/不存在的 id 静默过滤 —— 悬空引用保留在 block.tags 上）。 */
  function blockTags(blockId: string): PersistedTag[] {
    const blockStore = useBlockStore()
    const block = blockStore.getBlock(blockId)
    const ids = block?.tags ?? []
    return ids
      .map(id => getTagById(id))
      .filter((t): t is PersistedTag => !!t && !t.deleted_at)
  }

  return {
    tags,
    loaded,
    loading,
    userTags,
    ensureLoaded,
    getTagById,
    blockTags,
  }
})
