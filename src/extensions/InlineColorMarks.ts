import { Mark } from '@tiptap/core'

import { isTagColorToken } from '../utils/tag-color'

function readToken(attrs: Record<string, unknown>, key: string): string | null {
  const token = attrs[key]
  return isTagColorToken(token) ? token : null
}

/** 行内文字色。色值只接受调色板 token，避免任意 CSS 注入。 */
export const InlineTextColor = Mark.create({
  name: 'inlineTextColor',
  inclusive: true,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: element => element.getAttribute('data-inline-color'),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-inline-color]' }]
  },
  renderHTML({ mark }) {
    const token = readToken(mark.attrs, 'color')
    if (!token) return ['span', {}, 0]
    return ['span', { 'data-inline-color': token, style: `color: var(${token})` }, 0]
  },
})

/** 行内背景色（与文字色同色板，低透明度叠加以保证可读性）。 */
export const InlineBackgroundColor = Mark.create({
  name: 'inlineBackgroundColor',
  inclusive: true,
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: element => element.getAttribute('data-inline-bg'),
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-inline-bg]' }]
  },
  renderHTML({ mark }) {
    const token = readToken(mark.attrs, 'color')
    if (!token) return ['span', {}, 0]
    return [
      'span',
      {
        'data-inline-bg': token,
        style: `background-color: color-mix(in srgb, var(${token}) 28%, transparent); border-radius: 2px`,
      },
      0,
    ]
  },
})
