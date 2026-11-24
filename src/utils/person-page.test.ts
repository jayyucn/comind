/**
 * isPersonPage（person 页判据）纯函数测试（issue T10）。
 *
 * 判据：页面主页块（Page.blockId）挂了 id 'person' 的标签（Block.tags）。
 */
import { describe, it, expect } from 'vitest'
import { isPersonPage, PERSON_TAG_ID } from './person-page'

/** 块 → 标签清单的桩注入（组件侧接 blocks store，测试里用查表桩）。 */
function stubTagsOf(map: Record<string, string[] | undefined>) {
  return (blockId: string) => map[blockId]
}

describe('isPersonPage（person 页判据）', () => {
  it("主页块挂了 'person' 标签的页面 → true", () => {
    const page = { blockId: 'blk-1' }
    expect(isPersonPage(page, stubTagsOf({ 'blk-1': ['other', PERSON_TAG_ID] }))).toBe(true)
  })

  it('主页块没挂 person 标签（挂了别的标签）→ false', () => {
    const page = { blockId: 'blk-2' }
    expect(isPersonPage(page, stubTagsOf({ 'blk-2': ['project'] }))).toBe(false)
  })

  it('主页块无任何标签 → false', () => {
    const page = { blockId: 'blk-3' }
    expect(isPersonPage(page, stubTagsOf({ 'blk-3': [] }))).toBe(false)
  })

  it('主页块不在注入表中（悬空 blockId）→ false（不炸读路径）', () => {
    const page = { blockId: 'blk-missing' }
    expect(isPersonPage(page, stubTagsOf({}))).toBe(false)
  })

  it('无主页块（blockId null，如 ideas 页）→ false', () => {
    const page = { blockId: null }
    expect(isPersonPage(page, stubTagsOf({}))).toBe(false)
  })

  it('注入函数返回 undefined → false（与空清单同口径）', () => {
    const page = { blockId: 'blk-4' }
    expect(isPersonPage(page, stubTagsOf({ 'blk-4': undefined }))).toBe(false)
  })
})
