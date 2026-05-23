import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import ImageRender from './ImageRender.vue'

const { register } = useBlockRegistry()

register({
  type: 'image',
  label: 'Image',
  editorComponent: Editor,
  renderComponent: ImageRender
})