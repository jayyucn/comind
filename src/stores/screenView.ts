import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { Condition, ConditionValue, SortRule, ViewQuery } from '../core/query'
import { parseLayoutConfig, type LayoutConfig, type TableColumnConfig, type TableConfig, type ViewKind } from '../core/view'
import { defaultViewNameForEntity } from '../core/view/management'
import type { CoreClient } from '../wasm/client'
import { initCoreClient } from '../wasm/client'
import type { ScreenViewRust } from '../wasm/types'

/** 空查询（无筛选/排序/分组）。 */
export const EMPTY_VIEW_QUERY: ViewQuery = {
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
}

/**
 * 旧 BlockQuery 遗留形状（迁移用，不进入运行时类型；旧 useBlockQuery 已删除）。
 * 仅用于把存量视图 JSON 重映射到新 ViewQuery。
 */
type LegacyBlockField =
  | { kind: 'property'; key: string }
  | { kind: 'content' }
  | { kind: 'dateRef'; ref: 'kind' | 'date' }
interface LegacyBlockQuery {
  filters: { field: LegacyBlockField; op: string; value: unknown }[]
  sort: { field: LegacyBlockField; dir: 'asc' | 'desc' }[]
  groupBy: string | null
}

/** 旧 BlockQuery 字段 → 新引擎字段 key（content/dateRef 映射到注册表字段）。 */
function blockFieldToKey(f: LegacyBlockField): string {
  if (f.kind === 'property') return f.key
  if (f.kind === 'content') return 'content'
  return f.ref === 'kind' ? 'dateRefKind' : 'dateRefDate'
}

/** 存量旧 BlockQuery → 新 ViewQuery（字段形状重映射；op 均被新引擎支持，无需丢弃）。 */
export function blockQueryToViewQuery(bq: LegacyBlockQuery): ViewQuery {
  const children: Condition[] = bq.filters
    .map((c) => ({ field: blockFieldToKey(c.field), op: c.op as Condition['op'], value: c.value as ConditionValue }))
    .filter((c) => c.field)
  const sort: SortRule[] = bq.sort.map((s) => ({ field: blockFieldToKey(s.field), dir: s.dir }))
  return {
    version: 1,
    filter: { combinator: 'and', children },
    sort,
    groupBy: bq.groupBy,
  }
}

/**
 * 解析视图存储的 query_json：
 * - 新格式（version===1）→ 直接用；
 * - 旧格式（顶层 filters）→ blockQueryToViewQuery 迁移；
 * - 损坏/空 → EMPTY_VIEW_QUERY。
 */
export function parseViewQuery(json: string | undefined | null): ViewQuery {
  if (!json) return EMPTY_VIEW_QUERY
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && obj.filter) return obj as ViewQuery
    if (obj && Array.isArray(obj.filters)) return blockQueryToViewQuery(obj as LegacyBlockQuery)
  } catch {
    /* 解析失败回退空查询 */
  }
  return EMPTY_VIEW_QUERY
}

let coreClientPromise: Promise<CoreClient> | null = null

async function getClient(): Promise<CoreClient> {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  const client = await coreClientPromise
  if (!client) throw new Error('Core client not initialized')
  return client
}

export interface ScreenViewStoreOptions {
  /** 首次加载且无视图时 seed 的默认 Screen 名；缺省按实体键推导（block→全部任务 / page→全部页面）。 */
  defaultViewName?: string
  /** seed 的默认 Tab/Screen 类型；缺省 'table'。 */
  defaultViewType?: string
  /**
   * 该实体各视图类型的内建默认布局（seed/create 时写入 config）。
   * 由实体注册点提供（如 blockDefaultConfig / pageDefaultConfig）——store 不持有任何实体专属默认；
   * 缺省时 config 写入空串，渲染层按「无 config → 回退消费方默认」处理（ADR-0023 上游修复）。
   */
  defaultConfig?: (kind: ViewKind) => LayoutConfig
}

/**
 * 两级（Screen→Tab）命名视图 store 构建函数。封装 defineStore，使 registry 类型能从实际
 * 返回值推导，避免 Pinia 泛型被 Map 抹除导致 store.screens 等退化为 any（见 ADR-0009）。
 * 同一 entityKey 多次调用返回同一实例；不同实体互不干扰。
 */
function makeScreenViewStore(
  id: string,
  entityKey: string,
  defaultViewName: string,
  defaultViewType: string,
  defaultConfig?: (kind: ViewKind) => LayoutConfig,
) {
  return defineStore(id, () => {
      // 扁平存储：Screen（parent_id 空串）+ Tab（parent_id = 所属 Screen 的 id）
      const views = ref<ScreenViewRust[]>([])
      const currentScreenId = ref<string | null>(null)
      const currentTabId = ref<string | null>(null)
      const loading = ref(false)
      // 每 Screen 记住上次激活的 tab（内存态；刷新后重置）
      const lastTabByScreen = reactive<Record<string, string>>({})
      // 当前激活 tab 的可编辑查询（ViewQuery），与草稿互转
      const workingQuery = ref<ViewQuery>({ version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null })
      // 各 tab 是否有未保存更改（用于跨 tab / 跨 Screen 的脏点）
      const dirtyByTab = ref<Set<string>>(new Set())
      // 切走时暂存的草稿（tabId → ViewQuery）
      const drafts = ref<Record<string, ViewQuery>>({})

      // ── 派生 ──
      const screens = computed(() => views.value.filter((v) => !v.parent_id))
      const currentScreen = computed(() => screens.value.find((s) => s.id === currentScreenId.value) ?? null)
      const currentTabs = computed(() =>
        views.value
          .filter((v) => v.parent_id === currentScreenId.value)
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at),
      )
      const currentTab = computed(() => currentTabs.value.find((t) => t.id === currentTabId.value) ?? null)
      const dirty = computed(() => (currentTabId.value ? dirtyByTab.value.has(currentTabId.value) : false))
      const currentViewType = computed(() => currentTab.value?.view_type ?? defaultViewType)

      function committedQueryOf(tabId: string | null): ViewQuery {
        if (!tabId) return EMPTY_VIEW_QUERY
        const t = views.value.find((v) => v.id === tabId)
        return t ? parseViewQuery(t.query_json) : EMPTY_VIEW_QUERY
      }

      function nextScreenSort(): number {
        return screens.value.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1
      }
      function nextTabSort(screenId: string): number {
        return views.value.filter((v) => v.parent_id === screenId).reduce((m, t) => Math.max(m, t.sort_order), -1) + 1
      }

      // 实体默认布局 → config JSON（seed/create 写入）；未注入 defaultConfig 时写空串，渲染层回退消费方默认
      function configJson(kind: string): string {
        return defaultConfig ? JSON.stringify(defaultConfig(kind as ViewKind)) : ''
      }

      async function load(): Promise<ScreenViewRust[]> {
        loading.value = true
        try {
          const client = await getClient()
          views.value = await client.getScreenViews(entityKey)
          // 该实体无视图时 seed 默认 Screen + 一个默认 Tab
          if (views.value.length === 0) {
            const screen = await client.createScreen(
              entityKey,
              defaultViewName,
              defaultViewType,
              0,
              configJson(defaultViewType),
            )
            const tab = await client.createTab(
              entityKey,
              screen.id,
              '',
              defaultViewType,
              JSON.stringify(EMPTY_VIEW_QUERY),
              1,
              configJson(defaultViewType),
            )
            views.value = [screen, tab]
          }
          const defScreen = screens.value.find((s) => s.is_default === 1) ?? screens.value[0] ?? null
          if (defScreen) {
            currentScreenId.value = defScreen.id
            const tabId = lastTabByScreen[defScreen.id] ?? currentTabs.value[0]?.id ?? null
            if (tabId) await selectTab(tabId, true)
          }
          return views.value
        } finally {
          loading.value = false
        }
      }

      function stashCurrentIfDirty() {
        if (currentTabId.value && dirtyByTab.value.has(currentTabId.value)) {
          drafts.value[currentTabId.value] = JSON.parse(JSON.stringify(workingQuery.value))
        }
      }

      async function selectScreen(id: string) {
        if (id === currentScreenId.value) return
        stashCurrentIfDirty()
        currentScreenId.value = id
        const tabId = lastTabByScreen[id] ?? currentTabs.value[0]?.id ?? null
        if (tabId) await selectTab(tabId)
        else {
          currentTabId.value = null
          workingQuery.value = { ...EMPTY_VIEW_QUERY }
        }
      }

      async function selectTab(id: string, skipStash = false) {
        if (!skipStash && id === currentTabId.value) return
        if (!skipStash) stashCurrentIfDirty()
        currentTabId.value = id
        if (currentScreenId.value) lastTabByScreen[currentScreenId.value] = id
        const draft = drafts.value[id]
        if (draft) {
          workingQuery.value = JSON.parse(JSON.stringify(draft))
          dirtyByTab.value.add(id)
        } else {
          workingQuery.value = committedQueryOf(id)
          dirtyByTab.value.delete(id)
        }
      }

      function setWorkingQuery(q: ViewQuery) {
        workingQuery.value = q
        if (!currentTabId.value) return
        const committed = committedQueryOf(currentTabId.value)
        if (JSON.stringify(q) !== JSON.stringify(committed)) dirtyByTab.value.add(currentTabId.value)
        else dirtyByTab.value.delete(currentTabId.value)
      }

      async function saveActiveTab() {
        const tab = currentTab.value
        if (!tab) return
        const client = await getClient()
        const updated = await client.updateTab(tab.id, tab.name, tab.view_type, JSON.stringify(workingQuery.value), tab.config)
        const idx = views.value.findIndex((v) => v.id === tab.id)
        if (idx !== -1) views.value[idx] = updated
        dirtyByTab.value.delete(tab.id)
        delete drafts.value[tab.id]
      }

      async function discardActiveTab() {
        const tab = currentTab.value
        if (!tab) return
        workingQuery.value = committedQueryOf(tab.id)
        dirtyByTab.value.delete(tab.id)
        delete drafts.value[tab.id]
      }

      /** 解析某 tab 的表格布局配置；空/损坏时回退 seed 默认（与 store 初始化一致），再不行用空列集。 */
      function resolveTableConfig(tab: ScreenViewRust): TableConfig {
        const parsed = parseLayoutConfig(tab.config, 'table') as TableConfig | null
        if (parsed) return parsed
        if (defaultConfig) return defaultConfig('table') as TableConfig
        return { viewKind: 'table', version: 1, columns: [] }
      }

      /**
       * 仅改当前激活 tab 的 TableConfig（per-tab 显示/隐藏 + 排序，ADR-0011）。
       * transform 接收当前生效配置，返回新配置；持久化并经 updateTab 回流本地。
       */
      async function patchActiveTabConfig(transform: (cfg: TableConfig) => TableConfig) {
        const tab = currentTab.value
        if (!tab) return
        const next = transform(resolveTableConfig(tab))
        const client = await getClient()
        const updated = await client.updateTab(tab.id, tab.name, tab.view_type, tab.query_json, JSON.stringify(next))
        const idx = views.value.findIndex((v) => v.id === tab.id)
        if (idx !== -1) views.value[idx] = updated
      }

      /**
       * 改当前 Screen 下所有 table 类型 tab 的 TableConfig（全局增/删字段，ADR-0011）。
       * 非 table tab（board/calendar 无 columns）跳过；持久化并回流本地。
       */
      async function patchAllTabConfigs(transform: (cfg: TableConfig) => TableConfig) {
        const client = await getClient()
        for (const tab of currentTabs.value) {
          if (tab.view_type !== 'table') continue
          const next = transform(resolveTableConfig(tab))
          const updated = await client.updateTab(tab.id, tab.name, tab.view_type, tab.query_json, JSON.stringify(next))
          const idx = views.value.findIndex((v) => v.id === tab.id)
          if (idx !== -1) views.value[idx] = updated
        }
      }

      /** 当前激活 tab 的表格列配置（经 resolveTableConfig 回退 seed 默认，与 patch 写入一致，ADR-0011）。 */
      const activeTabColumns = computed<TableColumnConfig[]>(() =>
        currentTab.value ? resolveTableConfig(currentTab.value).columns : [],
      )

      async function createScreen(name?: string) {
        const client = await getClient()
        const screenName = name?.trim() || '未命名 Screen'
        const screen = await client.createScreen(
          entityKey,
          screenName,
          defaultViewType,
          nextScreenSort(),
          configJson(defaultViewType),
        )
        const tab = await client.createTab(
          entityKey,
          screen.id,
          '',
          defaultViewType,
          JSON.stringify(EMPTY_VIEW_QUERY),
          1,
          configJson(defaultViewType),
        )
        views.value.push(screen, tab)
        await selectScreen(screen.id)
      }

      async function createTab(name?: string, type?: string) {
        if (!currentScreenId.value) return
        const client = await getClient()
        const vt = type || currentViewType.value
        const tab = await client.createTab(
          entityKey,
          currentScreenId.value,
          name?.trim() ?? '',
          vt,
          JSON.stringify(workingQuery.value),
          nextTabSort(currentScreenId.value),
          configJson(vt),
        )
        views.value.push(tab)
        await selectTab(tab.id)
      }

      async function renameScreen(id: string, name: string) {
        const s = screens.value.find((x) => x.id === id)
        if (!s || !name.trim()) return
        const client = await getClient()
        const updated = await client.updateScreen(id, name.trim(), s.view_type, s.config)
        const idx = views.value.findIndex((v) => v.id === id)
        if (idx !== -1) views.value[idx] = updated
      }

      async function renameTab(id: string, name: string) {
        const t = views.value.find((v) => v.id === id)
        if (!t) return
        const client = await getClient()
        const updated = await client.updateTab(id, name, t.view_type, t.query_json, t.config)
        const idx = views.value.findIndex((v) => v.id === id)
        if (idx !== -1) views.value[idx] = updated
      }

      async function setDefaultScreen(id: string) {
        const client = await getClient()
        const updated = await client.setDefaultScreen(id)
        views.value = views.value.map((v) => (v.parent_id ? v : { ...v, is_default: v.id === id ? 1 : 0 }))
        const idx = views.value.findIndex((v) => v.id === id)
        if (idx !== -1) views.value[idx] = updated
      }

      async function deleteScreen(id: string) {
        if (screens.value.length <= 1) return
        const client = await getClient()
        await client.deleteScreen(id)
        const removed = new Set<string>([id, ...views.value.filter((v) => v.parent_id === id).map((v) => v.id)])
        views.value = views.value.filter((v) => !removed.has(v.id))
        delete lastTabByScreen[id]
        if (currentScreenId.value === id) {
          const next = screens.value[0]
          if (next) await selectScreen(next.id)
        }
      }

      async function deleteTab(id: string) {
        const s = currentScreen.value
        if (!s || currentTabs.value.length <= 1) return
        const client = await getClient()
        await client.deleteScreenView(id)
        views.value = views.value.filter((v) => v.id !== id)
        delete drafts.value[id]
        dirtyByTab.value.delete(id)
        if (currentTabId.value === id) {
          const next = currentTabs.value[0]
          if (next) await selectTab(next.id)
        }
      }

      async function duplicateTab(id: string, name: string) {
        const src = views.value.find((v) => v.id === id)
        if (!src || !currentScreenId.value) return
        const client = await getClient()
        const tab = await client.createTab(
          entityKey,
          currentScreenId.value,
          name,
          src.view_type,
          src.query_json,
          nextTabSort(currentScreenId.value),
          src.config,
        )
        views.value.push(tab)
        await selectTab(tab.id)
      }

      return {
        views,
        screens,
        currentScreen,
        currentTabs,
        currentTab,
        currentScreenId,
        currentTabId,
        currentViewType,
        dirty,
        dirtyByTab,
        workingQuery,
        loading,
        load,
        selectScreen,
        selectTab,
        setWorkingQuery,
        saveActiveTab,
        discardActiveTab,
        createScreen,
        createTab,
        renameScreen,
        renameTab,
        setDefaultScreen,
        deleteScreen,
        deleteTab,
        duplicateTab,
        patchActiveTabConfig,
        patchAllTabConfigs,
        activeTabColumns,
      }
    })
}

type ScreenViewStore = ReturnType<typeof makeScreenViewStore>

const storeRegistry = new Map<string, ScreenViewStore>()

export function useScreenViewStore(entityKey: string = 'block', options: ScreenViewStoreOptions = {}) {
  const id = `screenView:${entityKey}`
  const existing = storeRegistry.get(id)
  if (existing) return existing()
  const defaultViewName = options.defaultViewName ?? defaultViewNameForEntity(entityKey)
  const defaultViewType = options.defaultViewType ?? 'table'
  const def = makeScreenViewStore(id, entityKey, defaultViewName, defaultViewType, options.defaultConfig)
  storeRegistry.set(id, def)
  return def()
}
