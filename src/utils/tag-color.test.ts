/**
 * 标签配色单源测试（ADR-0050 D11）。
 *
 * 重点是**名单守卫**：调色板的色值定义在 `_semantic.scss`（亮/暗各一份），名单却必须
 * 同时存在于 TS（供选色器渲染与 `isTagColorToken` 校验）。两边漂移的症状很隐蔽 ——
 * 多出来的 swatch 渲染成透明点、或少掉的色选不回来。故此处直接读 SCSS 文本比对。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TAG_COLOR_TOKENS,
  isTagColorToken,
  tagChipStyle,
  tagDotStyle,
} from './tag-color'

// `import.meta.url` 经 vitest 变换后不是 file 协议（fileURLToPath 会抛错）→ 按仓库根解析。
// 路径写错会由 readFileSync 直接抛错，不会静默跳过守卫。
const SEMANTIC_SCSS = resolve(process.cwd(), 'src/styles/tokens/_semantic.scss')

describe('tag-color（标签配色单源）', () => {
  it('调色板与 _semantic.scss 的 --tag-color-* 名单严格一致（双向）', () => {
    const scss = readFileSync(SEMANTIC_SCSS, 'utf8')
    // 亮/暗各定义一次 → 用 Set 去重
    const declared = new Set(
      Array.from(scss.matchAll(/^\s*--(tag-color-\d+):/gm), (m) => `--${m[1]}`),
    )

    expect(declared.size).toBeGreaterThan(0)
    expect([...declared].sort()).toEqual([...TAG_COLOR_TOKENS].sort())
  })

  it('每个 token 在亮/暗两套主题里都有值', () => {
    const scss = readFileSync(SEMANTIC_SCSS, 'utf8')
    for (const token of TAG_COLOR_TOKENS) {
      const hits = scss.match(new RegExp(`^\\s*${token}:`, 'gm')) ?? []
      expect(hits, `${token} 应各在亮/暗重复定义一次`).toHaveLength(2)
    }
  })

  it('isTagColorToken 只认名单内的 token 名', () => {
    for (const token of TAG_COLOR_TOKENS) {
      expect(isTagColorToken(token)).toBe(true)
    }
    // 空串是**有效存储值**（无色），但不是调色板 token —— 必须落回默认样式
    for (const bad of ['', '#6366F1', '--color-tag', '--tag-color-', null, undefined, 3, {}]) {
      expect(isTagColorToken(bad), String(bad)).toBe(false)
    }
  })

  it('tagChipStyle：合法色 → 文字取该色 + 底色 10% 淡染', () => {
    expect(tagChipStyle('--tag-color-3')).toEqual({
      color: 'var(--tag-color-3)',
      background: 'color-mix(in srgb, var(--tag-color-3) 10%, transparent)',
    })
  })

  it('tagDotStyle：合法色 → 实心色点', () => {
    expect(tagDotStyle('--tag-color-7')).toEqual({ background: 'var(--tag-color-7)' })
  })

  it('无色（空串）与非法值一律 undefined —— 消费方落回 CSS 默认', () => {
    for (const style of [tagChipStyle, tagDotStyle]) {
      expect(style('')).toBeUndefined()
      expect(style(null)).toBeUndefined()
      expect(style(undefined)).toBeUndefined()
      // 未白名单的值不得进内联 style（CSS 注入面）
      expect(style('red; background: url(//evil)')).toBeUndefined()
    }
  })
})
