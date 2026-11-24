import { defineStore } from 'pinia'
import { computed,ref } from 'vue'

import type { CoreClient } from '../wasm/client'
import { initCoreClient } from '../wasm/client'
import type { BlockCard } from '../wasm/types'

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

/** 标脏后合并重拉的延迟：略大于一次字段写入往返，令 status ↔ priority 成对补写只刷一次。 */
const REFRESH_DELAY_MS = 120

export const useBlockCardStore = defineStore('blockCard', () => {
  const cards = ref<BlockCard[]>([])
  const loading = ref(false)
  const dirtyIds = ref<Set<string>>(new Set())
  const isFullyDirty = ref(false)
  /** 投影是否已在本会话拉过一次（自动重拉的前提，见 scheduleRefresh）。 */
  const hasLoaded = ref(false)

  /** Load all block cards from backend */
  async function load(): Promise<BlockCard[]> {
    loading.value = true
    try {
      const client = await getClient()
      cards.value = await client.getBlockCards()
      dirtyIds.value = new Set()
      isFullyDirty.value = false
      hasLoaded.value = true
      return cards.value
    } finally {
      loading.value = false
    }
  }

  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 脏标记的自动消费端 —— 让「谁负责刷新投影」从每个写入口的自觉变成 store 的单点保证。
   *
   * 背景：`invalidate` 只标脏，重拉一直依赖调用方主动 `getCards()`。但常驻视图
   * （标签聚合页的看板 / 表格 / 日历、任务中心）直接依赖 `cards` 投影，而字段区
   * （`BlockFieldZone` 的全部写入路径）、页面抽屉等只经 `fieldValueStore.setFieldValue`
   * 写库 + 标脏，不重拉 —— 于是改完 block 字段值，看板的分组 / 单元格停在旧值，
   * 直到重进页面（真机实证 2026-10-31）。同族缺口还有 `deleteFieldValue`（原先连脏都不标）。
   *
   * 为何不改成「写值后立即 await 重拉」：一次全量投影查询要跑遍所有块，成对补写
   * （status ↔ priority）会连发两次写入。故用合并重拉——同一轮内的多次标脏只触发一次
   * `load`，且仅当投影已被消费过（`hasLoaded`）时才做，纯正文编辑场景不为写值付全量查询。
   *
   * 失败不吞脏：`load` 抛错时脏集保持原样，下一次标脏仍会再试。
   */
  function scheduleRefresh(): void {
    if (!hasLoaded.value) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      // 已有重拉在飞（如单元格编辑后的显式 getCards）：让路重排——那次读的也是写库后的
      // 数据，与本次同源；并发再发一次只会多付一遍全量查询。
      if (loading.value) {
        scheduleRefresh()
        return
      }
      if (!isFullyDirty.value && dirtyIds.value.size === 0) return
      void load().catch(() => {})
    }, REFRESH_DELAY_MS)
  }

  /** Mark a specific block card as dirty (or all if no blockId) */
  function invalidate(blockId?: string): void {
    if (blockId) {
      dirtyIds.value.add(blockId)
    } else {
      isFullyDirty.value = true
    }
    // 标记即安排重拉：消费方可能是常驻视图，没有第二次机会主动来取。
    scheduleRefresh()
  }

  /** Refresh dirty cards before querying */
  async function refreshIfDirty(): Promise<void> {
    // 全脏或局部脏都全量重拉：脏卡片数据已过期，不能只剔除——
    // 剔除会让下游拿到残缺数据（如 project/area 已有值列表缺失刚保存的值）
    if (isFullyDirty.value || dirtyIds.value.size > 0) {
      await load()
    }
  }

  /** Get cards, refreshing if needed */
  async function getCards(): Promise<BlockCard[]> {
    await refreshIfDirty()
    if (cards.value.length === 0 && !loading.value) {
      await load()
    }
    return cards.value
  }

  const cardCount = computed(() => cards.value.length)

  return {
    cards,
    loading,
    cardCount,
    dirtyIds,
    isFullyDirty,
    load,
    invalidate,
    refreshIfDirty,
    getCards,
  }
})
