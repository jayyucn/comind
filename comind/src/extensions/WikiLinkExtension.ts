import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { PREDEFINED_RELATIONSHIPS } from '../utils/parser'

export interface WikiLinkDecoration {
  type: 'link' | 'relationship'
  page: string
  display: string
  relationshipType: string | null
  relationshipColor: string | null
  start: number
  end: number
}

let relationshipMenuCallback: ((pos: number, range: { from: number; to: number }, relationshipType: string | null) => void) | null = null

export function setRelationshipMenuCallback(callback: (pos: number, range: { from: number; to: number }, relationshipType: string | null) => void) {
  relationshipMenuCallback = callback
}

export function clearRelationshipMenuCallback() {
  relationshipMenuCallback = null
}

function getRelationshipColor(relationshipType: string | null): string {
  if (!relationshipType) return ''
  const config = PREDEFINED_RELATIONSHIPS.find(r => r.key === relationshipType)
  return config?.color || '#9E9E9E'
}

function getRelationshipLabel(relationshipType: string | null): string {
  if (!relationshipType) return ''
  const config = PREDEFINED_RELATIONSHIPS.find(r => r.key === relationshipType)
  return config?.label || relationshipType
}

function parseWikiLinks(text: string, basePos: number): WikiLinkDecoration[] {
  const decorations: WikiLinkDecoration[] = []
  const relationshipRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]\^?\(([^)]+)\)/gi
  const plainRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

  const processedRanges: Array<{ start: number; end: number }> = []

  let match
  while ((match = relationshipRegex.exec(text)) !== null) {
    const linkStart = match.index
    const linkEnd = linkStart + match[0].length
    const page = match[1]
    const display = match[2] || page
    const relationshipType = match[3]
    const color = getRelationshipColor(relationshipType)

    decorations.push({
      type: 'link',
      page,
      display,
      relationshipType,
      relationshipColor: color,
      start: basePos + linkStart,
      end: basePos + linkEnd
    })

    processedRanges.push({ start: linkStart, end: linkEnd })
  }

  while ((match = plainRegex.exec(text)) !== null) {
    const linkStart = match.index
    const linkEnd = linkStart + match[0].length

    const overlaps = processedRanges.some(
      r => linkStart < r.end && linkEnd > r.start
    )
    if (overlaps) continue

    const page = match[1]
    const display = match[2] || page

    decorations.push({
      type: 'link',
      page,
      display,
      relationshipType: null,
      relationshipColor: null,
      start: basePos + linkStart,
      end: basePos + linkEnd
    })

    processedRanges.push({ start: linkStart, end: linkEnd })
  }

  return decorations
}

export const WikiLinkExtension = Extension.create({
  name: 'wikiLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { doc } = state

            doc.descendants((node, pos) => {
              if (!node.isText) return

              const text = node.text || ''
              const wikiLinks = parseWikiLinks(text, pos)

              for (const wl of wikiLinks) {
                const linkText = `[[${wl.display}]]`

                const linkStart = wl.start
                const linkEnd = linkStart + linkText.length

                decorations.push(
                  Decoration.inline(linkStart, linkEnd, {
                    class: 'wiki-link',
                    'data-page': wl.page,
                    'data-display': wl.display,
                    'data-relationship-type': wl.relationshipType || ''
                  })
                )

                if (wl.relationshipType) {
                  decorations.push(
                    Decoration.inline(linkEnd, wl.end, {
                      class: 'wiki-link-relationship',
                      'data-relationship-type': wl.relationshipType,
                      'data-relationship-color': wl.relationshipColor || '',
                      'data-relationship-label': getRelationshipLabel(wl.relationshipType)
                    })
                  )
                }
              }
            })

            return DecorationSet.create(doc, decorations)
          },
          handleClick(view, pos, event) {
            const target = event.target as HTMLElement
            const dom = view.dom

            if (target.classList.contains('wiki-link-relationship')) {
              event.preventDefault()
              event.stopPropagation()

              const relationshipType = target.dataset.relationshipType || null

              if (relationshipMenuCallback) {
                relationshipMenuCallback(pos, { from: pos, to: pos }, relationshipType)
              }
              return true
            }

            if (target.classList.contains('wiki-link')) {
              const page = target.dataset.page
              if (page) {
                const clickEvent = new CustomEvent('wiki-link-page-click', {
                  bubbles: true,
                  detail: { page }
                })
                dom.dispatchEvent(clickEvent)
              }
            }

            return false
          }
        },
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
          }
        },
      })
    ]
  }
})
