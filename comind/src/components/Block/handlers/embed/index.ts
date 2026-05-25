import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import EmbedRender from './EmbedRender.vue'

const { register } = useBlockRegistry()

register({
  type: 'embed',
  label: 'Embed',
  editorComponent: Editor,
  renderComponent: EmbedRender
})