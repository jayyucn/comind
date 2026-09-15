/**
 * useUndoHistory —— ADR-0046 撤销历史栈核心（T2 / issue #107）。
 *
 * 机制：整页快照（memento，D8）。观测点：监听权威状态 `blocks` 数组 + 属性表
 * （D9），按页面隔离（Map<pageId, HistoryStack>，D6）。~500ms idle 合并窗口
 * （D3 自动满足：一次结构操作的多次写入落在同一响应式批次，天然合成一步）。
 *
 * 约定（勿额外实现项）：不去重 / 不轮询 / 不序列化比较（D9 已定 deep watch 更优）；
 * 不落库（D5 结构性必然）；不含页面级元数据（D4③）。
 *
 * 归因口径：每页挂一个「派生签名」看门狗（源 = 该页 blocks 的内容签名 + 该页
 * 属性签名），而非对全局 `blocks` 挂一个 deep watch。背景加载别的页（其它页块
 * push 进共享 `blocks` 数组）不会改变当前页签名 → 不会误触发、不会产生重复快照。
 * 签名只用于「哪页变了」的归因，不是「新旧快照判重」的 dedupe（本票禁 dedupe）。
 */
import { watch, type WatchStopHandle } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import type { Block } from '../types/block'
import type { Property } from '../types/property'

/** 单页快照信封：正文 + 结构 + format(含折叠) + 属性表（D11） */
export interface HistoryEntry {
  blocks: Block[]
  properties: Record<string, Property[]>
}

const DEFAULT_IDLE_MS = 500
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

// ---- 模块级单例状态（会话内，跨组件共享）----
interface PageStack {
  stack: HistoryEntry[]
  cursor: number
  seqs: number[]
}
let pageStacks = new Map<string, PageStack>()
const timeline: { seq: number; pageId: string }[] = []
let seqCounter = 0
let totalBytes = 0
let idleMs = DEFAULT_IDLE_MS
let maxBytes = DEFAULT_MAX_BYTES
const stopHandles = new Map<string, WatchStopHandle[]>()
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

// ---- 配置（仅供单测注入，生产走默认值）----
export function configureUndoHistory(opts: { idleMs?: number; maxBytes?: number }): void {
  if (opts.idleMs !== undefined) idleMs = opts.idleMs
  if (opts.maxBytes !== undefined) maxBytes = opts.maxBytes
}

/** 清空全部状态（单测用） */
export function resetUndoHistory(): void {
  for (const handles of stopHandles.values()) handles.forEach((h) => h())
  stopHandles.clear()
  for (const t of idleTimers.values()) clearTimeout(t)
  idleTimers.clear()
  pageStacks = new Map()
  timeline.length = 0
  seqCounter = 0
  totalBytes = 0
  idleMs = DEFAULT_IDLE_MS
  maxBytes = DEFAULT_MAX_BYTES
}

// ---- 深拷贝（约束 4：仓库无可用深拷贝，structuredClone 在 jsdom 下无法克隆
//      reactive 代理；此处按 Block 已知形状手写，并剔除 renderSegments 与
//      properties 两个派生字段 —— D11，真机省 48.5%）----
function deepClonePlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => deepClonePlain(v)) as unknown as T
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepClonePlain((value as Record<string, unknown>)[k])
  }
  return out as unknown as T
}

function cloneBlockSlim(b: Block): Block {
  return {
    id: b.id,
    pageId: b.pageId,
    parentId: b.parentId,
    pos: b.pos,
    content: b.content,
    format: deepClonePlain(b.format),
    type: b.type,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  }
}

function cloneProperty(p: Property): Property {
  // createdAt/updatedAt 归一化为 0：服务端写入的时间戳不承载恢复语义，却会漂移 ——
  // 撤销「删块」后复活块的组件重挂载，useBlockPropertySync.onMounted 会
  // loadBlockProperties 从 DB 重读，而恢复批次的 property set 刚刷过 updated_at。
  // 若签名含该字段，「同一状态」会被判成一次新改动 ⇒ 推入一份近似重复的快照并截断
  // redo 尾（2026-09-15 实机：删块 → Ctrl+Z 后约 500ms 起 Ctrl+Shift+Z 变 null；
  // 实测唯一漂移字节 = 属性行的 updatedAt）。信封只承载恢复所需字段，故归零。
  return { ...p, value: deepClonePlain(p.value), createdAt: 0, updatedAt: 0 }
}

// ---- 字节预算（D5：32MB 上限，超限裁最旧）----
function utf8Len(str: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length
  // jsdom / 旧环境兜底
  return unescape(encodeURIComponent(str)).length
}

function byteSize(snap: HistoryEntry): number {
  return utf8Len(JSON.stringify(snap))
}

/** 属性信封（D11）：{ blockId → 属性深拷贝[] }。captureEntry 与 propSig 的**单一真源** ——
 *  两处必须逐字节一致，否则「签名变了 ⇔ 快照会变」不成立（Spec #7）。 */
function propEnvelope(pageBlocks: Block[]): Record<string, Property[]> {
  const propertyStore = usePropertyStore()
  const properties: Record<string, Property[]> = {}
  for (const b of pageBlocks) {
    const props = propertyStore.propertiesByBlock.get(b.id)
    if (props && props.length > 0) properties[b.id] = props.map(cloneProperty)
  }
  return properties
}

// ---- 快照捕获 ----
function captureEntry(pageId: string): HistoryEntry {
  const pageBlocks = useBlockStore().getBlocksByPage(pageId)
  return { blocks: pageBlocks.map(cloneBlockSlim), properties: propEnvelope(pageBlocks) }
}

// ---- 归因签名（哪页变了，非 dedupe）----
/**
 * 该页 blocks 的内容签名。与 captureEntry 同源 —— 直接序列化 cloneBlockSlim
 * 的输出，保证「签名变了 ⇔ 快照会变」。新增文档态字段只需改 cloneBlockSlim 一处
 * （Spec #7），签名自动跟进，不再手工枚举字段清单（曾在两处维护、易漏）。
 * 背景加载其它页不会改变本页签名（filter 出的块相同）。
 */
function blockSig(pageId: string): string {
  const blockStore = useBlockStore()
  return JSON.stringify(blockStore.getBlocksByPage(pageId).map(cloneBlockSlim))
}

/** 该页属性的签名。与 captureEntry 共用 propEnvelope（Spec #7：单一真源）。 */
function propSig(pageId: string): string {
  return JSON.stringify(propEnvelope(useBlockStore().getBlocksByPage(pageId)))
}

// ---- 公开 API ----
/** 开始跟踪某页：捕获初始快照并挂上逐页看门狗（幂等）。调用方须确保该页已整页加载（D6 落地 + 防残缺快照） */
export function ensureStack(pageId: string): void {
  if (pageStacks.has(pageId)) return
  const snap = captureEntry(pageId)
  const seq = ++seqCounter
  pageStacks.set(pageId, { stack: [snap], cursor: 0, seqs: [seq] })
  timeline.push({ seq, pageId })
  totalBytes += byteSize(snap)

  const stopB = watch(() => blockSig(pageId), () => schedule(pageId))
  const stopP = watch(() => propSig(pageId), () => schedule(pageId))
  stopHandles.set(pageId, [stopB, stopP])
}

/**
 * 立即封口（不等 idle）：取消该页的防抖定时器 + 立刻把当前状态压入栈。
 *
 * 供键盘接管在撤销/重做之前调用。成因：用户「最后一段输入」有两种未成步形态 ——
 * ① 还停在 300ms 落库防抖里（store 尚未更新）；② 已进 store 但本模块 ~500ms idle
 * 窗口未到。两者都使栈顶仍是「输入前」，直接 undo 会「看似无反应」（#109 验收：
 * 任何焦点一致、无无反应落点）。封口把这段未成步的改动立刻变成一步，撤销才会退回
 * 输入前的状态。
 *
 * 与 pushSnapshot 共用回声判定：当前状态与游标处快照相同 ⇒ no-op（不新增、也不截
 * redo 尾），故「无改动时连按 Ctrl+Z」不会被封口吃掉重做分支。
 */
export function commitNow(pageId: string): void {
  const pending = idleTimers.get(pageId)
  if (pending) {
    clearTimeout(pending)
    idleTimers.delete(pageId)
  }
  pushSnapshot(pageId)
}

function schedule(pageId: string): void {
  const existing = idleTimers.get(pageId)
  if (existing) clearTimeout(existing)
  idleTimers.set(
    pageId,
    setTimeout(() => {
      idleTimers.delete(pageId)
      pushSnapshot(pageId)
    }, idleMs),
  )
}

function pushSnapshot(pageId: string): void {
  const ps = pageStacks.get(pageId)
  if (!ps) return
  const { stack, seqs } = ps

  const snap = captureEntry(pageId)
  // 回声抑制（须在截断 redo 尾之前判定）：若新捕获与「当前游标处」快照逐字节相同
  // （典型为 T3 的 restoreEntry 改动 reactive 状态后触发了本页 watcher），本次
  // 不是用户动作 —— 直接跳过：不入栈、也不截断 redo 尾。否则「撤销→恢复」的回声
  // 会先吃掉 redo 分支再被跳过，redo 从此丢失；且撤销后回声入栈会让连按两次
  // Ctrl+Z 看似无效。这不是禁项目里的「用户动作去重」——只拦「状态已与游标处
  // 相同」的回声；真实编辑产出的快照必定不同，不受影响。
  const top = stack[ps.cursor]
  if (top && JSON.stringify(top) === JSON.stringify(snap)) {
    return
  }

  // 截断 redo 尾：撤销后发生新动作 ⇒ 标准 redo 清空语义
  if (ps.cursor < stack.length - 1) {
    const removedSeqs = seqs.splice(ps.cursor + 1)
    stack.splice(ps.cursor + 1)
    for (const sq of removedSeqs) {
      const idx = timeline.findIndex((t) => t.seq === sq)
      if (idx >= 0) timeline.splice(idx, 1)
    }
  }

  const size = byteSize(snap)
  stack.push(snap)
  const seq = ++seqCounter
  seqs.push(seq)
  timeline.push({ seq, pageId })
  totalBytes += size
  ps.cursor = stack.length - 1
  evictIfNeeded()
}

/**
 * 32MB 字节预算，超限裁最旧（D5）。timeline 按 seq 升序，shift 即全局最旧。
 * 退化标注（#107 验收#3）：真实库无 >500 块页，按 ADR-0046 实测，32MB 预算下
 * 几乎永不触发裁切；若单页 >500 块，单次观测/快照成本见 ADR-0046 实测记录，须重估。
 */
function evictIfNeeded(): void {
  while (totalBytes > maxBytes && timeline.length > 0) {
    const old = timeline.shift()!
    const ps = pageStacks.get(old.pageId)
    if (!ps || ps.stack.length === 0) continue
    const removedSnap = ps.stack.shift()!
    totalBytes -= byteSize(removedSnap)
    ps.seqs.shift()
    // 游标不变量：本函数唯一调用点（pushSnapshot 尾）刚把游标锚到栈顶，故每次 shift 后
    // cursor-1 恰好仍是新栈顶；Math.max(0,…) 只在「该页最后一份快照自身超预算、栈被清空」
    // 时兜底 —— 那时栈空、所有读取都走长度守卫，与 cursor=-1 不可区分（勿按「游标静默
    // 前移」再修：曾有一次审查如此误报，未能给出游标不在栈顶的调用路径）。
    ps.cursor = Math.max(0, ps.cursor - 1)
  }
}

/** 撤销：游标前移一位，返回目标快照；无可撤返回 null */
export function undo(pageId: string): HistoryEntry | null {
  const ps = pageStacks.get(pageId)
  if (!ps) return null
  if (ps.cursor <= 0) return null
  const next = ps.cursor - 1
  ps.cursor = next
  return ps.stack[next]
}

/** 重做：游标后移一位，返回目标快照；无可重做返回 null */
export function redo(pageId: string): HistoryEntry | null {
  const ps = pageStacks.get(pageId)
  if (!ps) return null
  if (ps.cursor >= ps.stack.length - 1) return null
  const next = ps.cursor + 1
  ps.cursor = next
  return ps.stack[next]
}

export function canUndo(pageId: string): boolean {
  const ps = pageStacks.get(pageId)
  if (!ps) return false
  return ps.cursor > 0
}

export function canRedo(pageId: string): boolean {
  const ps = pageStacks.get(pageId)
  if (!ps) return false
  return ps.cursor < ps.stack.length - 1
}

/** 某页是否已建撤销栈（页面隔离 D6 的查询口，供跨页接管判定用） */
export function hasStack(pageId: string): boolean {
  return pageStacks.has(pageId)
}

/** 仅供单测断言内部状态 */
export function _debugStats() {
  return {
    totalBytes,
    timelineLen: timeline.length,
    stackSizes: Object.fromEntries([...pageStacks.entries()].map(([k, v]) => [k, v.stack.length])),
  }
}
