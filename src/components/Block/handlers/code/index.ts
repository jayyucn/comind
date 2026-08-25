import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import CodeMirrorEditor from './CodeMirrorEditor.vue'

const { register } = useBlockRegistry()

register({
  type: 'code',
  label: '代码块',
  editorComponent: CodeMirrorEditor,
  renderComponent: CodeMirrorEditor,
})