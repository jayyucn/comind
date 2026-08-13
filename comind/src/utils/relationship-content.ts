/**
 * relationship 关系类型内容转换工具
 *
 * 设计目标：编辑态显示中文 label，存储态保存英文 type（Rust 只认 type）。
 *
 * 语法（与 content_parse_service.rs 保持一致）：
 *   ((type))            → 单方向
 *   ((type<->inverse))  → 双向
 *   ((type!))           → auto-inverse
 *   ((type))[[Page]]    → typed link（type 段独立于 [[Page]]）
 *
 * decode：存储 → 编辑态显示。((is-a)) → ((是一个))，查不到原样保留。
 * encode：编辑态 → 存储。((是一个)) → ((is-a))，查不到原样保留。
 *
 * 快照机制（Q7 改名安全）：
 *   decode 返回 { text, snapshot }，snapshot 为「解码后文本 → 原始 type」
 *   映射（位置无关，抗编辑位移）。encode 时优先用快照还原；
 *   快照缺失时按 label→type 逆查兜底。
 *   这样设置里改 label 后，未编辑的 block 保存不会把 ((is-a))
 *   退化成 ((旧label))。
 *
 * 已删除类型：decode/encode 均不转换（保留原文），
 *   渲染端对已删除类型有独立样式（灰色 + "(已删除)" 后缀），
 *   编辑态显示原文 type 更诚实，也避免反向污染 content。
 */
import { useRelationshipTypes } from '../composables/useRelationshipTypes'

/**
 * 编辑会话快照缓存：blockId → (解码后内部文本 → 原始 type 内部文本)
 * decode（进入编辑态）写入，encode（保存）读取后清除。
 * 模块级缓存保证 Block/index.vue 的 editContent 与
 * useBlockEditorLifecycle.handleSave 之间共享同一快照。
 */
const snapshotCache = new Map<string, Map<string, string>>()

export function setRelationshipSnapshot(
  blockId: string,
  snapshot: Map<string, string>,
): void {
  snapshotCache.set(blockId, snapshot)
}

export function takeRelationshipSnapshot(
  blockId: string,
): Map<string, string> | undefined {
  const s = snapshotCache.get(blockId)
  snapshotCache.delete(blockId)
  return s
}

/** 关系类型记录（all 视图含已删除） */
interface TypeRecord {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  deleted: boolean
}

/** 匹配 ((...)) 段。group 1 = 完整段（含括号），group 2 = 内部内容 */
const RELATIONSHIP_SEGMENT_RE = /(\(\(([^)]+)\)\))/g

/** 双向格式：type<->inverse */
const BIDIRECTIONAL_RE = /^(.+?)<->(.+)$/

/** auto-inverse 格式：type! */
const AUTO_INVERSE_RE = /^(.*)!$/

/** 构建 type→记录 与 label→记录 双索引（含已删除；label 冲突时后者覆盖） */
function buildMaps() {
  const all = useRelationshipTypes().all.value
  const byType = new Map<string, TypeRecord>()
  const byLabel = new Map<string, TypeRecord>()
  for (const r of all) {
    const rec: TypeRecord = {
      type: r.type,
      inverse: r.inverse,
      label: r.label,
      inverseLabel: r.inverseLabel,
      deleted: r.deleted,
    }
    byType.set(r.type, rec)
    if (r.inverse) byType.set(r.inverse, rec)
    byLabel.set(r.label, rec)
    byLabel.set(r.inverseLabel, rec)
  }
  return { byType, byLabel }
}

/** 解析 ((...)) 内部内容 → 各段 */
export interface RelationshipSegmentParts {
  /** 原始内部内容（如 "is-a" / "depends-on<->required-by" / "depends-on!"） */
  raw: string
  /** 正向 type（去掉了 <-> / ! 修饰符） */
  type: string
  /** 反向 type（仅双向格式有） */
  inverse?: string
  /** 是否为 auto-inverse（type! 格式） */
  autoInverse?: boolean
}

export function parseRelationshipSegment(inner: string): RelationshipSegmentParts {
  const bi = inner.match(BIDIRECTIONAL_RE)
  if (bi) {
    return { raw: inner, type: bi[1].trim(), inverse: bi[2].trim() }
  }
  const auto = inner.match(AUTO_INVERSE_RE)
  if (auto && auto[1].length > 0) {
    return { raw: inner, type: auto[1].trim(), autoInverse: true }
  }
  return { raw: inner, type: inner.trim() }
}

/**
 * decode：存储（type）→ 编辑态显示（label）
 *
 * ((is-a))                        → ((是一个))
 * ((depends-on<->required-by))    → ((依赖<->被依赖))
 * ((depends-on!))                 → ((依赖!))
 *
 * 返回 { text, snapshot }：
 *   - text 为转换后的编辑态文本
 *   - snapshot 为 Map<解码后内部文本, 原始内部文本>（位置无关）
 * 未知/已删除 type 原样保留，不记快照。
 */
export function decodeRelationshipContent(
  content: string,
): { text: string; snapshot: Map<string, string> } {
  const snapshot = new Map<string, string>()
  if (!content.includes('((')) {
    return { text: content, snapshot }
  }

  const { byType } = buildMaps()
  let result = ''
  let lastIndex = 0
  RELATIONSHIP_SEGMENT_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = RELATIONSHIP_SEGMENT_RE.exec(content)) !== null) {
    const full = match[0]
    const inner = match[2]
    const start = match.index

    result += content.slice(lastIndex, start)

    const parts = parseRelationshipSegment(inner)
    const rec = byType.get(parts.type)
    // 未知或已删除 → 原样保留
    if (!rec || rec.deleted) {
      result += full
      lastIndex = start + full.length
      continue
    }

    let decoded: string
    if (parts.inverse !== undefined) {
      const invRec = byType.get(parts.inverse)
      if (!invRec || invRec.deleted) {
        // 反向未知/已删除 → 整体原样保留（避免半转换破坏语义）
        result += full
        lastIndex = start + full.length
        continue
      }
      const forwardLabel = rec.type === parts.type ? rec.label : rec.inverseLabel
      const inverseLabel = invRec.type === parts.inverse ? invRec.label : invRec.inverseLabel
      decoded = `${forwardLabel}<->${inverseLabel}`
    } else if (parts.autoInverse) {
      const label = rec.type === parts.type ? rec.label : rec.inverseLabel
      decoded = `${label}!`
    } else {
      const label = rec.type === parts.type ? rec.label : rec.inverseLabel
      decoded = label
    }
    snapshot.set(decoded, inner)
    result += `((${decoded}))`
    lastIndex = start + full.length
  }
  result += content.slice(lastIndex)
  return { text: result, snapshot }
}

/**
 * encode：编辑态显示（label）→ 存储（type）
 *
 * ((是一个))                  → ((is-a))
 * ((依赖<->被依赖))           → ((depends-on<->required-by))
 * ((依赖!))                   → ((depends-on!))
 *
 * 优先级：快照还原 → label→type 逆查 → 原样保留。
 */
export function encodeRelationshipContent(
  content: string,
  snapshot?: Map<string, string>,
): string {
  if (!content.includes('((')) {
    return content
  }

  const { byLabel } = buildMaps()
  let result = ''
  let lastIndex = 0
  RELATIONSHIP_SEGMENT_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = RELATIONSHIP_SEGMENT_RE.exec(content)) !== null) {
    const full = match[0]
    const inner = match[2]
    const start = match.index

    result += content.slice(lastIndex, start)

    // 1) 快照还原（改名后未编辑的 label → 原始 type）
    if (snapshot && snapshot.has(inner)) {
      result += `((${snapshot.get(inner)}))`
      lastIndex = start + full.length
      continue
    }

    // 2) label→type 逆查
    const parts = parseRelationshipSegment(inner)
    const rec = byLabel.get(parts.type)
    if (rec && !rec.deleted) {
      const forwardType = rec.type === rec.label ? rec.type : undefined
      // 判断 label 属于正向还是反向
      const isForwardLabel = parts.type === rec.label
      const type = isForwardLabel ? rec.type : rec.inverse ?? rec.type
      if (parts.inverse !== undefined) {
        const invRec = byLabel.get(parts.inverse)
        if (invRec && !invRec.deleted) {
          const invIsForward = parts.inverse === invRec.label
          const invType = invIsForward ? invRec.type : invRec.inverse ?? invRec.type
          result += `((${type}<->${invType}))`
        } else {
          result += full
        }
      } else if (parts.autoInverse) {
        result += `((${type}!))`
      } else {
        result += `((${type}))`
      }
      lastIndex = start + full.length
      continue
    }

    // 3) 都查不到 → 原样保留（渲染端回退显示原文）
    result += full
    lastIndex = start + full.length
  }
  result += content.slice(lastIndex)
  return result
}
