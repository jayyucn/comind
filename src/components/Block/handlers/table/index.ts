import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import TableBlock from './TableBlock.vue'

const { register } = useBlockRegistry()

register({
  type: 'table',
  label: 'Table',
  editorComponent: TableBlock,
  renderComponent: TableBlock,
})
