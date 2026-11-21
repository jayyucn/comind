import { h } from 'vue'
import { describe, expect, it } from 'vitest'

import { useBlockEntryMenuExtra } from './useBlockEntryMenuExtra'

/**
 * 入口菜单类型专属段的注册表（菜单收敛到 Block 外壳后，handler ↔ 外壳的交接点）。
 *
 * 这里只锁三件会真的咬人的事：按块取用、卸载不误删、空 id 不登记。
 */
describe('useBlockEntryMenuExtra', () => {
  const { register, unregister, get } = useBlockEntryMenuExtra()
  const node = (text: string) => h('span', text)
  const extra = (text: string) => ({ render: (_close: () => void) => [node(text)] })

  it('注册后按 blockId 取到该 handler 交出的专属段', () => {
    register('blk-a', extra('表头开关'))
    expect(get('blk-a')?.render(() => {})).toHaveLength(1)
    unregister('blk-a')
    expect(get('blk-a')).toBeNull()
  })

  it('同一块挂两份（双 pane 同页）：后注册者胜出，先卸载的不误删', () => {
    const first = extra('旧实例')
    const second = extra('新实例')
    register('blk-b', first)
    register('blk-b', second)

    // 先挂的那份卸载时带着自己的身份，不能把仍在用的那份删掉
    unregister('blk-b', first)
    expect(get('blk-b')).toBe(second)

    unregister('blk-b', second)
    expect(get('blk-b')).toBeNull()
  })

  it('不带身份的注销照删（handler 卸载路径的兜底）', () => {
    register('blk-c', extra('x'))
    unregister('blk-c')
    expect(get('blk-c')).toBeNull()
  })

  it('空 blockId 不登记（standalone 渲染的表格块没有 id）', () => {
    register('', extra('x'))
    expect(get('')).toBeNull()
  })
})
