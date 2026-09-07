// useReaderTypography 单测（票 04）：默认值 / localStorage 持久化跨会话 /
// 非法与越界值回退钳制。模块级单例 → 每用例 vi.resetModules 后动态 import。
import { describe, it, expect, beforeEach } from 'vitest'

async function freshModule() {
  const mod = await import('./useReaderTypography')
  return mod.useReaderTypography()
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('useReaderTypography', () => {
  it('无存储时返回默认值', async () => {
    const { typography } = await freshModule()
    expect(typography.value).toEqual({
      fontSize: 17,
      lineHeight: 1.8,
      maxWidthCh: 42,
      theme: 'light',
    })
  })

  it('更新后写入 localStorage，新会话（重新加载模块）恢复', async () => {
    const a = await freshModule()
    a.updateTypography({ fontSize: 20, lineHeight: 1.6, maxWidthCh: 36, theme: 'sepia' })

    // 新「会话」：重置模块缓存后重新加载，从 localStorage 恢复
    vi.resetModules()
    const b = await freshModule()
    expect(b.typography.value).toEqual({
      fontSize: 20,
      lineHeight: 1.6,
      maxWidthCh: 72,
      theme: 'sepia',
    })
    expect(localStorage.getItem('comind-reader-typography')).toBeTruthy()
  })

  it('localStorage 损坏 JSON 回退默认（不 throw）', async () => {
    localStorage.setItem('comind-reader-typography', '{broken json')
    const { typography } = await freshModule()
    expect(typography.value.theme).toBe('light')
    expect(typography.value.fontSize).toBe(17)
  })

  it('越界值被钳制到合法区间，非法类型回退', async () => {
    localStorage.setItem(
      'comind-reader-typography',
      JSON.stringify({ fontSize: 999, lineHeight: 0.1, maxWidthCh: 5, theme: 'neon' }),
    )
    const { typography } = await freshModule()
    expect(typography.value.fontSize).toBe(24)
    expect(typography.value.lineHeight).toBe(1.4)
    expect(typography.value.maxWidthCh).toBe(28)
    expect(typography.value.theme).toBe('light')
  })

  it('步进调节并钳制边界', async () => {
    const { typography, stepFontSize, stepLineHeight, stepMaxWidth } = await freshModule()

    stepFontSize(1)
    expect(typography.value.fontSize).toBe(19)
    stepLineHeight(-1)
    expect(typography.value.lineHeight).toBe(1.7)
    stepMaxWidth(1)
    expect(typography.value.maxWidthCh).toBe(72)

    // 上界钳制
    for (let i = 0; i < 10; i++) stepFontSize(1)
    expect(typography.value.fontSize).toBe(24)
    // 下界钳制
    for (let i = 0; i < 20; i++) stepLineHeight(-1)
    expect(typography.value.lineHeight).toBe(1.4)
  })
})
