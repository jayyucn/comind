import { TAG_REGEX } from '../utils/parser'

const CSS_CLASSES = {
  blockLink: 'block-link',
  blockTag: 'block-tag',
  tagSegment: 'tag-segment',
  tagSep: 'tag-sep'
}

export function useContentRenderer() {
  function escapeHtmlEntities(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderContentToHtml(text: string): string {
    const html = escapeHtmlEntities(text)
    return html
      .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
        return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
      })
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
        const display = alias || target
        return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
      })
      .replace(TAG_REGEX, (_, tag) => {
        if (tag.includes('.')) return `#${tag}`
        const parts = tag.split('/')
        const rendered = parts.map((p: string, i: number) => {
          const span = `<span class="${CSS_CLASSES.tagSegment}">${escapeHtmlEntities(p)}</span>`
          return i < parts.length - 1 ? span + `<span class="${CSS_CLASSES.tagSep}">/</span>` : span
        }).join('')
        return `<span class="${CSS_CLASSES.blockTag}">#${rendered}</span>`
      })
  }

  return { renderContentToHtml }
}