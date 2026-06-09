import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import ConceptRender from './ConceptRender.vue'

const { register } = useBlockRegistry()

// Concept Block — ConceptRender 同时负责展示和编辑
register({
  type: 'concept',
  label: 'Concept',
  editorComponent: ConceptRender,
  renderComponent: ConceptRender
})
