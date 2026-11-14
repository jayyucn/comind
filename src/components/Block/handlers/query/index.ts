import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import QueryBlock from './QueryBlock.vue'

const { register } = useBlockRegistry()

// 与 table 块同构：两态同一个组件（无文本编辑态，交互全在块内视图里）。
register({
  type: 'query',
  label: 'Query',
  editorComponent: QueryBlock,
  renderComponent: QueryBlock,
})
