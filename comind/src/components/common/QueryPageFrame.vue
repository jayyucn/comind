<script setup lang="ts" generic="T">
import { computed } from 'vue'
import type { FieldDescriptor, Group, ReferenceableRecord, Registry, SortRule, ViewQuery } from '../../core/query'
import type { ViewTypeOption } from '../../core/view/management'
import type { BoardConfig, CalendarConfig, TableConfig } from '../../core/view'
import { useChipBarOrchestration } from '../../composables/useChipBarOrchestration'
import { useScreenViewStore } from '../../stores/screenView'
import NamedViewBar from './NamedViewBar.vue'
import PageTitle from './PageTitle.vue'
import QueryChipBar from '../query/QueryChipBar.vue'
import QueryToolbar from '../query/QueryToolbar.vue'
import BoardView from '../views/BoardView.vue'
import CalendarView from '../views/CalendarView.vue'
import TableView from '../views/TableView.vue'

defineOptions({ name: 'QueryPageFrame' })

/**
 * 查询页外壳：装配「标题 + 命名视图条（Screen→Tab 两级）+ 查询工具条 + 芯片行 + 主内容区」的整页骨架，
 * 并把芯片行编排（显隐/激活态/按钮转发）、命名视图 store 绑定与视图切换内聚于此（ADR-0023 D1/D6）。
 * 泛型组件：视图数据契约（items/groups/…）由消费方按实体注入；外壳硬编码渲染通用三件套
 * （TableView/BoardView/CalendarView），「包含哪几个视图」由 viewTypes prop 决定（消费方只传参数，
 * 不含任何视图切换逻辑）。零业务依赖（ADR-0009）：不 import 任何实体 store/registry。
 */
const props = defineProps<{
  /** 页面标题（PageTitle）。 */
  title: string
  /** 页面副标题（PageTitle，如「32 个任务」）。 */
  subtitle: string
  /** screen_view 命名空间（NamedViewBar / 命名视图 store）。兼作查询引擎实体命名空间（ADR-0023 D3）。 */
  entityKey: string
  /** 该实体可选的视图类型（注入 NamedViewBar；同时决定外壳渲染哪几个视图，类型创建后固定）。 */
  viewTypes: ViewTypeOption[]
  defaultViewName?: string
  defaultViewType?: string
  /** 可筛选/排序/分组的字段清单（QueryChipBar + 三个视图）。 */
  fields: FieldDescriptor[]
  /** 字段注册表（QueryChipBar 高级筛选需要）。 */
  registry: Registry
  /** 跨记录引用候选记录列表（业务无关，从业务层注入；缺省时 recordRef 不暴露）。 */
  crossRecordSources?: ReferenceableRecord[]
  /** 搜索词（v-model:search 受控，父级持有真相用于数据过滤）。 */
  search?: string
  // ── 视图数据契约（通用三件套共享，实体相关由消费方注入；ADR-0023 D6）──
  /** 已过滤+排序的扁平列表（TableView/BoardView/CalendarView 共用）。 */
  items: T[]
  /** 分组桶（TableView 按 groupBy 渲染分组区块时用）。 */
  groups: Group<T>[]
  /** 是否按 groupBy 渲染分组区块（TableView）。 */
  grouped: boolean
  /** 当前排序规则（TableView 表头方向图标）。 */
  sort: SortRule[]
  /** 看板分组字段 key（BoardView；TaskHub: viewQuery.groupBy ?? 'status'）。 */
  groupBy: string | null
  tableConfig?: TableConfig
  boardConfig?: BoardConfig
  calendarConfig: CalendarConfig
  /** 取记录 id 的字段名（默认 'id'；BlockCard 用 'block_id'）。 */
  idKey?: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  /** 单元格编辑（boolean/select 可编辑列触发；由消费方处理）。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击行/卡片导航到源记录（由消费方处理）。 */
  navigate: [itemId: string]
}>()

// 命名视图 store（按 entityKey 隔离；NamedViewBar 内部同 key 单例复用）
const store = useScreenViewStore(props.entityKey, {
  defaultViewName: props.defaultViewName,
  defaultViewType: props.defaultViewType,
})
// 当前激活 tab 的可编辑查询（单一数据源：NamedViewBar 的保存/清除/切换均作用于它）
const viewQuery = computed<ViewQuery>(() => store.workingQuery)
// 当前激活 tab 的视图类型（驱动主内容区渲染哪个视图）
const currentViewType = computed(() => store.currentViewType)

// 搜索词：v-model:search 受控（外壳持有输入态，父级经 update:search 落库并过滤数据）
const searchQuery = computed({
  get: () => props.search ?? '',
  set: (v: string) => emit('update:search', v),
})

// 芯片行编排（显隐/激活态/按钮转发）收进共享 composable（ADR-0022 Q6），由外壳直接内聚。
// chipBarRef 由 composable 内部 useTemplateRef 声明式绑定，模板 ref="chipBarRef" 关联即可。
const { chipBarVisible, hasFilter, hasSort, hasGroup, openChipMenu } =
  useChipBarOrchestration(viewQuery)
</script>

<template>
  <div class="query-page-frame">
    <PageTitle :title="title" :subtitle="subtitle" />

    <!-- 视图管理（Screen→Tab 两级 + 查询工具条 + 未保存提示均内聚于 NamedViewBar） -->
    <NamedViewBar
      :entity-key="entityKey"
      :view-types="viewTypes"
      :default-view-name="defaultViewName"
      :default-view-type="defaultViewType"
    >
      <QueryToolbar
        v-model="searchQuery"
        :has-filter="hasFilter"
        :has-sort="hasSort"
        :has-group="hasGroup"
        :chip-bar-visible="chipBarVisible"
        @filter="openChipMenu('filter', $event)"
        @sort="openChipMenu('sort', $event)"
        @group="openChipMenu('group', $event)"
      />
    </NamedViewBar>

    <!-- 筛选芯片行（QueryToolbar 三按钮唤起；显隐/菜单策略内聚于 QueryChipBar；绑定 store.workingQuery） -->
    <QueryChipBar
      ref="chipBarRef"
      :model-value="store.workingQuery"
      :fields="fields"
      :registry="registry"
      :entity-type="entityKey"
      :cross-record-sources="crossRecordSources"
      @update:model-value="store.setWorkingQuery"
      @visible-change="chipBarVisible = $event"
    />

    <!-- 主内容区：硬编码渲染通用三件套（ADR-0023 D6）。
         包含哪几个视图由 viewTypes 决定（NamedViewBar 只允许建其中的类型，currentViewType 不会越出）；
         事件（cell-change/navigate）由外壳转发给消费方处理 -->
    <main class="lib-body">
      <TableView
        v-if="currentViewType === 'table'"
        :items="items"
        :fields="fields"
        :groups="groups"
        :grouped="grouped"
        :sort="sort"
        :config="tableConfig"
        :id-key="idKey"
        @cell-change="(itemId, fieldKey, value) => emit('cellChange', itemId, fieldKey, value)"
        @navigate="(itemId) => emit('navigate', itemId)"
      />
      <BoardView
        v-else-if="currentViewType === 'board'"
        :items="items"
        :fields="fields"
        :group-by="groupBy ?? ''"
        :config="boardConfig"
        :id-key="idKey"
        @cell-change="(itemId, fieldKey, value) => emit('cellChange', itemId, fieldKey, value)"
        @navigate="(itemId) => emit('navigate', itemId)"
      />
      <CalendarView
        v-else-if="currentViewType === 'calendar'"
        :items="items"
        :fields="fields"
        :config="calendarConfig"
        :id-key="idKey"
        @navigate="(itemId) => emit('navigate', itemId)"
      />
      <div v-else class="view-empty">
        <p>暂无可用的视图</p>
      </div>
    </main>
  </div>
</template>

<style lang="scss" scoped>
.query-page-frame {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 var(--space-8);
}

.lib-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 12px 16px;
  margin-bottom: var(--space-4);
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}

.view-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
