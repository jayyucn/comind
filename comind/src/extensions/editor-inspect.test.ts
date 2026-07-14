import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { DateRefExtension } from './DateRefExtension'
import { PluginKey } from '@tiptap/pm/state'
import { writeFileSync } from 'fs'

describe('inspect editor internals', () => {
  it('find dateRef plugin in editor', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const ed = new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, DateRefExtension],
      content: '<p>test</p>',
    })

    const _tiptap: any = (ed as any)._tiptapEditor
    const view: any = (ed as any).view
    const statePlugins = ed.state.plugins

    const info = {
      '_tiptapEditor exists': !!_tiptap,
      '_tiptapEditor.view exists': !!_tiptap?.view,
      'view.plugins count': _tiptap?.view?.plugins?.length ?? view?.plugins?.length,
      'state.plugins count': statePlugins.length,
      'state.plugins keys': statePlugins.map(String),
      'ed.view exists': !!(ed as any).view,
      'ed.view.plugins count': (ed as any).view?.plugins?.length,
    }

    writeFileSync('C:/Users/jay/.qclaw/debug_info.json', JSON.stringify(info, null, 2))
    ed.destroy()
    el.remove()
    expect(true).toBe(true)
  })
})
