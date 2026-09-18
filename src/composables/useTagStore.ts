import { initCoreClient } from '../wasm/client'
import type { Link } from '../wasm/types'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import type { PropertyType } from '../types/property'

/**
 * Supertag 成员关系 store（#130 / ADR-0049 D3、D4）。
 *
 * 薄封装：复用既有 Link 基础设施（block→page 链接 + relationship_type），
 * 不放宽 Link 结构。保留类型 `tag` / `extend` 仅经此处程序化写入，不进用户关系注册表。
 *
 * 范围：本文件覆盖 T2（applyTag / resolveTagMembers + 保留类型约束）、
 * T3（模板存储 / effectiveFields 派生 / 继承合并）、T7（删标签级联清 link）。
 */

/** 成员关系的系统保留关系类型 */
export const TAG_RELATIONSHIP = 'tag' as const
/** 继承关系的系统保留关系类型 */
export const EXTEND_RELATIONSHIP = 'extend' as const

/**
 * 标签字段类型词汇（复用查询引擎 FieldDescriptor 的字段词汇，含 select/multiSelect）。
 * 注意：落在 block 上的**值**仍以 {@link PropertyType} 存（select→string、multiSelect→array）。
 */
export type TagFieldType = PropertyType | 'select' | 'multiSelect'

/**
 * 可序列化的标签字段描述符（模板存储形态，#131 / ADR-0049 D5）。
 * 是 `FieldDescriptor` 的纯数据子集：不含 `get` 取值函数（无法 JSON 化），
 * 渲染取值时改读 block 真实属性值。复用现有字段词汇（key/label/type/options）。
 */
export interface TagFieldSpec {
  /** 字段唯一 key（同标签命名空间内唯一） */
  key: string
  /** UI 展示标签 */
  label: string
  /** 数据类型，决定值编辑器 */
  type: TagFieldType
  /** select / multiSelect 选项（id 即存储值） */
  options?: { id: string; label: string; color?: string }[]
  /** select 选项排序 */
  sortOrder?: string[]
}

/** 把标签字段类型映射到落库用的 PropertyType（select→string、multiSelect→array） */
export function tagFieldValueType(type: TagFieldType): PropertyType {
  if (type === 'select') return 'string'
  if (type === 'multiSelect') return 'array'
  return type
}

/** 模板存储所用的 property key（落在 tag-page 区块上，属系统元数据） */
const TAG_TEMPLATE_KEY = 'template' as const

/**
 * 解析标签页用于挂模板属性的区块 id。
 * tag-page 经 `createPage` 创建时不一定有区块（blockId 可能为 null）。
 *
 * `create=false`（只读路径，默认）：**不得建块**——读模板发生在渲染期
 * （`effectiveFields` → `getTagTemplate`），建块+落库是渲染副作用，且违反
 * 「O(1) 读模板」（#131）。改为只认 `page.blockId` 或 store 中已缓存的本页根块，
 * 都没有则返回 null（调用方按「无模板」处理）。
 * `create=true`（写入路径）：`ensurePageBlocks` 补根块并强制落库后返回其 id。
 */
async function resolveTagPageBlockId(tagPageId: string, create = false): Promise<string | null> {
  const page = usePageStore().getPage(tagPageId)
  if (!page || page.type !== 'tag') return null
  if (page.blockId) return page.blockId
  const blockStore = useBlockStore()
  if (!create) return blockStore.blocks.find(b => b.pageId === tagPageId && !b.parentId)?.id ?? null
  await blockStore.ensurePageBlocks(tagPageId)
  let root = blockStore.blocks.find(b => b.pageId === tagPageId && !b.parentId)
  if (!root) return null
  // 强制落库：`ensurePageBlocks` 建块走防抖保存，未落库时下一次调用会
  // 再次建块 → block id 漂移（写/读落到底不同块上）。flush 后 id 稳定。
  await blockStore.flushSave(root.id)
  root = blockStore.blocks.find(b => b.pageId === tagPageId && !b.parentId)
  return root?.id ?? null
}

let clientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!clientPromise) {
    clientPromise = initCoreClient()
  }
  return clientPromise
}

export function useTagStore() {
  /**
   * 给 block 贴标签：程序化创建 `Link{ relationship_type: 'tag' }`（block → tagPage）。
   *
   * - 护栏：目标必须是 `type='tag'` 的页，否则拒绝（避免把 tag 关系写到普通页）。
   * - 幂等：同一 (block, tagPage) 已存在 tag link 时直接返回既有记录，不重复建。
   *
   * @returns 创建的 Link 记录（含 id / source_block_id / target_page_id / relationship_type）。
   */
  async function applyTag(blockId: string, tagPageId: string): Promise<Link> {
    const tagPage = usePageStore().getPage(tagPageId)
    if (!tagPage) throw new Error('applyTag 失败：目标 tag 页不存在')
    if (tagPage.type !== 'tag') {
      throw new Error('applyTag 失败：目标必须是 type=\'tag\' 的页')
    }

    const client = await getClient()

    // 幂等：先查既有 tag link，存在则直接复用
    const existing = (await client.getOutlinks(blockId)).find(
      l => l.relationship_type === TAG_RELATIONSHIP && l.target_page_id === tagPageId
    )
    if (existing) return existing

    const id = `tag_${blockId}_${tagPageId}`
    await client.executeBatch([{
      entity: 'link',
      action: 'create',
      // 注意 snake_case（batch.rs link create 用 Rust Link 反序列化）
      params: {
        id,
        source_block_id: blockId,
        target_page_id: tagPageId,
        display_text: tagPage.title,
        relationship_type: TAG_RELATIONSHIP,
      },
    }])

    // 本仓约定（见 user-templates.ts）：落库后返回本地构造的记录，
    // 不依赖 executeBatch 的返回形态（WASM 路径回裸 value 数组、Tauri 路径不同）。
    const created: Link = {
      id,
      source_block_id: blockId,
      target_page_id: tagPageId,
      display_text: tagPage.title,
      relationship_type: TAG_RELATIONSHIP,
      created_at: Date.now(),
    }
    return created
  }

  /**
   * 反查某标签页的成员 block 集（applyTag 的反向操作）。
   *
   * 经 `getBacklinks(tagPageId)` 取全部入边，过滤 `relationship_type==='tag'`，
   * 按 source_block_id 去重（支持多 block 同贴一 tag、一 block 贴多 tag）。
   *
   * @returns 成员 blockId 数组（去重、顺序稳定由 LinkService 决定）。
   */
  async function resolveTagMembers(tagPageId: string): Promise<string[]> {
    const client = await getClient()
    const links = await client.getBacklinks(tagPageId)
    const memberIds = links
      .filter(l => l.relationship_type === TAG_RELATIONSHIP)
      .map(l => l.source_block_id)
    return [...new Set(memberIds)]
  }

  // ── T3：标签模板定义 + 字段注入渲染（#131 / ADR-0049 D5、D6、D7）──

  /**
   * 写标签页模板：存于 tag-page 区块的 `template` 属性（JSON 字符串）。
   * 单一数据源（D5）；不写入成员 block 的 property store（派生不物化，D6）。
   */
  async function setTagTemplate(tagPageId: string, fields: TagFieldSpec[]): Promise<void> {
    const blockId = await resolveTagPageBlockId(tagPageId, true)
    if (!blockId) throw new Error('setTagTemplate 失败：目标 tag 页不存在或无区块')
    const client = await getClient()
    await client.setProperty(blockId, TAG_TEMPLATE_KEY, JSON.stringify(fields), 'string')
  }

  /**
   * 读标签页模板；不存在/解析失败返回空数组（容错，不抛）。
   */
  async function getTagTemplate(tagPageId: string): Promise<TagFieldSpec[]> {
    const blockId = await resolveTagPageBlockId(tagPageId)
    if (!blockId) return []
    const client = await getClient()
    const props = await client.getProperties(blockId)
    const tpl = props.find(p => p.key === TAG_TEMPLATE_KEY)
    if (!tpl || typeof tpl.value !== 'string') return []
    try {
      const parsed = JSON.parse(tpl.value)
      return Array.isArray(parsed) ? (parsed as TagFieldSpec[]) : []
    } catch {
      return []
    }
  }

  /**
   * 解析标签继承链（沿 `relationshipType='extend'` 出边，BFS，防环）。
   * 返回「就近优先」的祖先 tagPageId 列表（直接父在前、更远祖先在后）。
   */
  async function resolveInheritance(tagPageId: string): Promise<string[]> {
    const client = await getClient()

    const result: string[] = []
    const visited = new Set<string>([tagPageId])
    const queue: string[] = []

    // 注意：`getOutlinks` 以 **page id** 为参（聚合该页所有块的出链，见 wasm lib.rs）。
    // extend 链接的 source 是标签页根块，故按标签页 id 取即可。
    const seed = await client.getOutlinks(tagPageId)
    for (const l of seed.filter(l => l.relationship_type === EXTEND_RELATIONSHIP)) {
      queue.push(l.target_page_id)
    }

    while (queue.length) {
      const pid = queue.shift()!
      if (visited.has(pid)) continue // 防环：已访问（含自身）跳过
      visited.add(pid)
      result.push(pid)
      const pOut = await client.getOutlinks(pid)
      for (const l of pOut.filter(l => l.relationship_type === EXTEND_RELATIONSHIP)) {
        if (!visited.has(l.target_page_id)) queue.push(l.target_page_id)
      }
    }
    return result
  }

  /**
   * 派生某标签的有效字段：本标签模板 + 继承链合并（D7），冲突就近覆盖
   * （自身 > 直接父 > 更远祖先）。纯异步函数，O(1) 读模板。
   */
  async function effectiveFields(tagPageId: string): Promise<TagFieldSpec[]> {
    const own = await getTagTemplate(tagPageId)
    const ancestors = await resolveInheritance(tagPageId) // 就近优先
    const merged = new Map<string, TagFieldSpec>()
    // 先铺最远祖先（ancestors 反序），再逐层覆盖到最近父，最后自身覆盖
    for (const pid of [...ancestors].reverse()) {
      for (const spec of await getTagTemplate(pid)) {
        if (!merged.has(spec.key)) merged.set(spec.key, spec)
      }
    }
    for (const spec of own) merged.set(spec.key, spec)
    return [...merged.values()]
  }

  /**
   * 派生某 block 的有效字段：合并其贴的所有标签（含各自继承链）。
   * E1 多标签同名字段冲突规则：**先应用（created_at 最早）的标签胜**；
   * 同 created_at 时按 tagPageId 升序兜底，保证确定性。
   * 不向 block 的 property store 写入任何模板字段（派生不物化）。
   */
  async function effectiveFieldsForBlock(blockId: string): Promise<TagFieldSpec[]> {
    // getOutlinks 以 page id 为参，需先由 block 找到其所在页；再按 source_block_id
    // 收窄到「本 block」的 tag 出边（同页其他 block 的链接不参与）。
    const block = useBlockStore().blocks.find(b => b.id === blockId)
    if (!block) return []
    const client = await getClient()
    const tagLinks = (await client.getOutlinks(block.pageId))
      .filter(l => l.source_block_id === blockId && l.relationship_type === TAG_RELATIONSHIP)
      .sort((a, b) => a.created_at - b.created_at || a.target_page_id.localeCompare(b.target_page_id))

    const merged = new Map<string, TagFieldSpec>()
    for (const link of tagLinks) {
      for (const spec of await effectiveFields(link.target_page_id)) {
        if (!merged.has(spec.key)) merged.set(spec.key, spec) // 先贴先胜
      }
    }
    return [...merged.values()]
  }

  // ── T7：删标签级联清理（#135）──

  /**
   * 删除标签页：委托核心级联 `deletePageCascade`，其已清理
   *  (1) 作为 target 的全部 Link（`delete_by_target_page_id`）——含成员 `tag` Link
   *      与作为父标签的 `extend` Link；
   *  (2) block 级联删除作为 source 的 `extend` Link（`delete_by_source_block_id`）。
   * 因此硬删 tag-page 后无悬空引用（E3）。tag 删除走硬级联，不用 softDeletePage
   * （仅标 deleted 会残留悬空 Link）。
   */
  async function deleteTagPage(tagPageId: string): Promise<void> {
    const page = usePageStore().getPage(tagPageId)
    if (!page) throw new Error('deleteTagPage 失败：目标 tag 页不存在')
    if (page.type !== 'tag') throw new Error('deleteTagPage 失败：目标必须是 type=\'tag\' 的页')
    await usePageStore().deletePage(tagPageId)
  }

  return {
    applyTag,
    resolveTagMembers,
    setTagTemplate,
    getTagTemplate,
    resolveInheritance,
    effectiveFields,
    effectiveFieldsForBlock,
    deleteTagPage,
    TAG_RELATIONSHIP,
    EXTEND_RELATIONSHIP,
  }
}
