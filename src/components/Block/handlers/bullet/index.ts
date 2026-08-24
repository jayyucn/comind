import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import BulletRender from './BulletRender.vue'

const { register } = useBlockRegistry()

register({
  type: 'bullet',
  label: 'Bullet',
  editorComponent: Editor,
  renderComponent: BulletRender
})