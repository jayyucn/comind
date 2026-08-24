import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import CodeMirrorEditor from './CodeMirrorEditor.vue'

const { register } = useBlockRegistry()

register({
  type: 'code',
  label: 'Code',
  editorComponent: CodeMirrorEditor,
  renderComponent: CodeMirrorEditor,
})