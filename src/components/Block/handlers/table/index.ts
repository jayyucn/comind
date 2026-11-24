import { TableProperties } from 'lucide-vue-next'

import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import TableBlock from './TableBlock.vue'

const { register } = useBlockRegistry()

register({
  type: 'table',
  label: 'Table',
  editorComponent: TableBlock,
  renderComponent: TableBlock,
  // 入口图标替代 bullet dot：点击开表格菜单，按下拖动即拖拽手柄（Block 外壳统一渲染）。
  // 16px = TableBlock 的 --table-pad-top，把图标压到表头行上；两处需同步。
  entryIcon: TableProperties,
  entryLabel: '表格菜单',
  entryTop: '16px',
})
