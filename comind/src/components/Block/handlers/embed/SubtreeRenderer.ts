import { defineComponent, h, type PropType } from 'vue'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import type { SubtreeNode } from '../../../../types/block'

const SubtreeRenderer = defineComponent({
  name: 'SubtreeRenderer',
  props: {
    node: { type: Object as PropType<SubtreeNode>, required: true },
    depth: { type: Number, required: true }
  },
  emits: ['content-click', 'language-change'],
  setup(props, { emit }) {
    const { getHandler } = useBlockRegistry()

    function handleContentClick(e: MouseEvent) {
      e.stopPropagation()
      emit('content-click', e)
    }

    function handleLanguageChange(lang: string) {
      emit('language-change', lang)
    }

    return (): ReturnType<typeof h> => {
      const { node, depth } = props
      const handler = getHandler(node.block.type)
      const isEmbed = node.block.type === 'embed'
      const indentStyle = depth > 0 ? { paddingLeft: `${depth * 20}px` } : {}

      const children = node.children.map(child =>
        h(SubtreeRenderer, {
          node: child,
          depth: depth + 1,
          key: child.block.id,
          onContentClick: handleContentClick,
          onLanguageChange: handleLanguageChange
        })
      )

      if (isEmbed) {
        return h('div', { class: 'embed-block-row', style: indentStyle }, [
          h('span', { class: 'embed-block-bullet' }, [h('span', { class: 'bullet-dot' })]),
          h('div', { class: 'embed-block-content' }, [
            h('div', { class: 'embed-circular-warning' }, 'Nested embed')
          ])
        ])
      }

      if (!handler) {
        return h('div', { class: 'embed-block-row', style: indentStyle }, [
          h('span', { class: 'embed-block-bullet' }, [h('span', { class: 'bullet-dot' })]),
          h('div', { class: 'embed-block-content' }, [
            h('div', { class: 'embed-child-placeholder' }, `${node.block.type} (not registered)`)
          ])
        ])
      }

      return h('div', { class: 'embed-subtree' }, [
        h('div', { class: 'embed-block-row', style: indentStyle }, [
          h('span', { class: 'embed-block-bullet' }, [h('span', { class: 'bullet-dot' })]),
          h('div', { class: 'embed-block-content' }, [
            h(handler.renderComponent, {
              content: node.block.content,
              properties: node.block.properties,
              showPlaceholder: false,
              readonly: true,
              key: node.block.id,
              onContentClick: handleContentClick,
              onLanguageChange: handleLanguageChange
            })
          ])
        ]),
        ...children
      ])
    }
  }
})

export default SubtreeRenderer
