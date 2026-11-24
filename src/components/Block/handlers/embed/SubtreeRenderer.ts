import { defineComponent, h, type PropType } from 'vue'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import { useFieldValueStore } from '../../../../stores/fieldValue'
import { decodeFieldValueData } from '../../../../utils/field-value-codec'
import type { SubtreeNode } from '../../../../types/block'
import type { FieldValueData } from '../../../../types/field-definition'

const SubtreeRenderer = defineComponent({
  name: 'SubtreeRenderer',
  props: {
    node: { type: Object as PropType<SubtreeNode>, required: true },
    depth: { type: Number, required: true }
  },
  emits: ['content-click', 'language-change'],
  setup(props, { emit }) {
    const { getHandler } = useBlockRegistry()
    const fieldValueStore = useFieldValueStore()

    function handleContentClick(e: MouseEvent) {
      // 不 stopPropagation：让 click 继续 DOM 冒泡到外层 .embed-card，
      // 否则嵌入卡片的跳转/选中态无法触发（Fix: Bug 2 click to jump）。
      emit('content-click', e)
    }

    function handleLanguageChange(lang: string) {
      emit('language-change', lang)
    }

    function getBlockFieldValuesMap(blockId: string): Record<string, FieldValueData> {
      const rows = fieldValueStore.getBlockFieldValues(blockId)
      const result: Record<string, FieldValueData> = {}
      for (const fv of rows) {
        result[fv.key] = decodeFieldValueData(fv.value_json, fv.value_type) as FieldValueData
      }
      return result
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
              fieldValues: getBlockFieldValuesMap(node.block.id),
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
