import { Type } from 'lucide-vue-next'

import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import BulletRender from './BulletRender.vue'

const { register } = useBlockRegistry()

register({
  type: 'bullet',
  label: 'Bullet',
  editorComponent: Editor,
  renderComponent: BulletRender,
  // 入口胶囊的类型字形：文本块用 `Type`（T 字形），与表格/查询同一套胶囊（Block 外壳统一渲染）。
  entryIcon: Type,
})