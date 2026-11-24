import { SlidersHorizontal } from 'lucide-vue-next'

import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import QueryBlock from './QueryBlock.vue'

const { register } = useBlockRegistry()

// 与 table 块同构：两态同一个组件（无文本编辑态，交互全在块内视图里）。
// 入口图标替代 bullet dot：点击开查询块菜单，按下拖动即拖拽手柄（Block 外壳统一渲染）。
// 8px = QueryBlock 的 --query-block-pad-top；两处需同步。
register({
  type: 'query',
  label: 'Query',
  editorComponent: QueryBlock,
  renderComponent: QueryBlock,
  entryIcon: SlidersHorizontal,
  entryLabel: '查询块菜单',
  entryTop: '8px',
})
