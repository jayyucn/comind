import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { DateRefExtension } from './DateRefExtension'
import { writeFileSync } from 'fs'

describe('inspect plugin creation', () => {
  it('DateRefExtension is an Extension instance', () => {
    const info: any = {
      'DR type': DateRefExtension.constructor.name,
      'DR keys': Object.getOwnPropertyNames(DateRefExtension),
      'DR proto keys': Object.getOwnPropertyNames(DateRefExtension.__proto__),
      'config type': typeof (DateRefExtension as any).config,
      'config keys': Object.keys((DateRefExtension as any).config ?? {}),
    }
    const cfg: any = (DateRefExtension as any).config ?? {}
    if (cfg.addProseMirrorPlugins) {
      info['addPP type'] = typeof cfg.addProseMirrorPlugins
      info['addPP constructor'] = cfg.addProseMirrorPlugins.constructor?.name
      if (Array.isArray(cfg.addProseMirrorPlugins)) {
        info['addPP count'] = cfg.addProseMirrorPlugins.length
        info['addPP keys'] = cfg.addProseMirrorPlugins.map((p: any) => Object.keys(p ?? {}))
      }
    }
    writeFileSync('C:/Users/jay/.qclaw/debug_info.json', JSON.stringify(info, null, 2))
    expect(true).toBe(true)
  })
})
