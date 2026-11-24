/**
 * person 页判据（issue T10）——纯函数，供 PageRefPicker 的 personOnly 过滤等场景。
 *
 * 判据说明：仓库没有独立的「人员」实体，person 页 = **挂了 id 为 'person' 的
 * 标签的页面**（经 TagsLibrary 给标签起 id 'person' 约定即可圈出人员页）。
 * 标签挂在块上（Block.tags，反规范化 tag id 列表），页面经 Page.blockId 关联
 * 其主页块——判据即「页面的主页块挂了 'person' 标签」。
 *
 * 依赖方向：type-only import Page，块 → 标签的读取经 BlockTagsOf 注入，
 * 本模块不碰任何 store（纯函数可测）。
 */
import type { Page } from '../types/page'

/** person 标签 id 约定值（用户建标签时把 id 定为 'person' 即圈出人员页）。 */
export const PERSON_TAG_ID = 'person'

/** 判据注入口：块 id → 该块挂的 tag id 清单（组件侧接 blocks store 的 getBlock().tags）。 */
export type BlockTagsOf = (blockId: string) => readonly string[] | undefined

/**
 * 页面是否 person 页：主页块挂了 'person' 标签。
 * 无主页块（blockId 为 null）或块上无该标签 → false。
 */
export function isPersonPage(page: Pick<Page, 'blockId'>, blockTagsOf: BlockTagsOf): boolean {
  if (!page.blockId) return false
  return (blockTagsOf(page.blockId) ?? []).includes(PERSON_TAG_ID)
}
