import { Link2 } from 'lucide-vue-next'

import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import type { BlockTypeHandler } from '../../../../types/block-type'
import { WEB_LINK_TYPE } from '../../../../utils/web-link'
import WebLinkBlock from './WebLinkBlock.vue'

const { register } = useBlockRegistry()

/**
 * 网页链接块（ADR-0066）。
 *
 * 与 image 块同属「视图型块」：没有块编辑器，`editorComponent` 与 `renderComponent`
 * 复用同一个组件，正文（URL）由组件内的行内输入框改写。
 * 因此 mousedown / click 一律拦下，块不会被拉进编辑态 —— 否则整块会进入
 * 「active」外观，而它并没有可激活的编辑器。
 */
const webLinkHandler: BlockTypeHandler = {
  type: WEB_LINK_TYPE,
  label: '网页链接',
  entryIcon: Link2,
  entryLabel: '网页链接',
  editorComponent: WebLinkBlock,
  renderComponent: WebLinkBlock,
  setupBlock() {
    return {
      onContentMousedown() {
        return true
      },
      onContentClick() {
        return true
      },
    }
  },
}

register(webLinkHandler)
