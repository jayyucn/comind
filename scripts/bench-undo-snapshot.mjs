// ADR-0046 前置门禁：撤销快照的内存压力测试（grill-up 2026-09-14 Jay 裁定「开工前先做」）
//
// 测量对象 = 权威状态的**真实形状**：扁平 Block[] + properties map（blocks.ts:137）。
// 三条对比路线：
//   A full  —— 深拷贝整个 Block（含 renderSegments / properties 两个派生冗余字段）
//   B json  —— JSON round-trip 全字段（structuredClone 不可用，见 FilterBuilder.vue:31 注释）
//   C slim  —— 只拷快照真正需要的字段（= 与 SnapshotContent 同形的 {blocks, properties}）
//
// 跑法：node --expose-gc scripts/bench-undo-snapshot.mjs
//
// ⚠️ 标定修正（2026-09-14 真机复测后补 —— 勿只看本脚本下结论）
// 本脚本用**合成数据 + 原生对象**，与真机（tauri-mcp 直读 store）在两个方向上有偏差：
//   1) 体积高估约 3x：合成 838 B/块（slim），真机 270 B/块（真实正文中位数仅 17 字符）。
//   2) 时序结论**方向相反**：原生对象上「一次全量读」远快于 deep watch；但真机 store 是
//      **Vue 响应式代理**，Proxy trap 开销反而让全量读比 deep watch 更贵。真机实测
//      （真实数据形状复制到 84 / 252 / 504 / 1008 块）：
//        deep watch 单次  1.8 / 3.1 / 5.6 / 9.9 ms
//        一次全量读       1.2 / 3.4 / 6.7 / 13.5 ms
//      ⇒ 本脚本下方「轮询更省」的结论不成立；时序一律以真机为准。
// 保留用途：内存体积的**上界压力测试**（合成数据更重 = 更保守）与深拷耗时基线。
import { ref, watch } from 'vue'

const PAGE_SIZES = [100, 500, 2000]
const STACK_STEPS = 200 // D5 的深度上限上界

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORDS = ['设计', '架构', '边界', '折叠', '快照', '撤销', '区块', '属性', '查询', '视图',
  '编辑器', '历史', '粒度', '封口', '派生', '权威', '状态', '落库', '内存', '事务',
  'selection', 'undo', 'buffer', 'commit', 'render']
const KEYS = ['status', 'priority', 'due']

function text(rand, len) {
  let s = ''
  while (s.length < len) {
    s += WORDS[Math.floor(rand() * WORDS.length)]
    if (rand() < 0.25) s += ' '
    if (rand() < 0.03) s += `[[页面${Math.floor(rand() * 50)}]] `
  }
  return s.slice(0, len)
}

function contentLen(rand) {
  const r = rand()
  if (r < 0.6) return 30 + Math.floor(rand() * 120)
  if (r < 0.9) return 150 + Math.floor(rand() * 250)
  return 400 + Math.floor(rand() * 800)
}

function makeProperty(rand, blockId, key, idx) {
  return {
    id: `prop_${blockId}_${idx}`, block_id: blockId, key,
    value: String(Math.floor(rand() * 1000)), type: 'string', sort_order: idx,
    is_hidden: 0, is_deleted: 0, schema_version: 1,
    created_at: 1757800000000, updated_at: 1757800000000,
  }
}

function makePage(n) {
  const rand = mulberry32(20260914)
  const blocks = []
  const properties = {}
  for (let i = 0; i < n; i++) {
    const id = `blk_${String(i).padStart(6, '0')}`
    const content = text(rand, contentLen(rand))

    const segments = []
    if (content.includes('[[')) {
      const linkCount = 1 + Math.floor(rand() * 3)
      for (let k = 0; k < linkCount; k++) {
        if (rand() < 0.4) {
          segments.push({ type: 'link', start: k * 10, end: k * 10 + 8, target_page_title: `页面${k}`, display_text: `页面${k}` })
        } else {
          segments.push({ type: 'typed_link', start: k * 10, end: k * 10 + 8, target_page_title: `页面${k}`, display_text: `页面${k}`, relationship_type: 'related', rel_label: '相关', rel_color: '#3B82F6' })
        }
      }
    }

    let format = {}
    const fr = rand()
    if (fr < 0.08) format = { collapsed: true }
    else if (fr < 0.12) format = { align: 'center', width: 640, height: 360 }

    const props = []
    const pc = Math.floor(rand() * 3)
    for (let k = 0; k < pc; k++) props.push(makeProperty(rand, id, KEYS[k], k))

    const block = {
      id, pageId: 'page-bench',
      parentId: i === 0 ? null : (i % 7 === 0 ? null : `blk_${String(i - 1).padStart(6, '0')}`),
      pos: (i + 1) * 1000, content, format,
      type: format.width ? 'image' : 'bullet',
      createdAt: 1757800000000, updatedAt: 1757800000000,
    }
    if (segments.length) block.renderSegments = segments
    if (props.length) block.properties = props
    blocks.push(block)
    if (props.length) properties[id] = props.map((p) => ({ ...p }))
  }
  return { blocks, properties }
}

function deepClone(v) {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(deepClone)
  const o = {}
  for (const k in v) o[k] = deepClone(v[k])
  return o
}

const SLIM_KEYS = ['id', 'pageId', 'parentId', 'pos', 'content', 'type', 'createdAt', 'updatedAt']

// 路线 C：只保留快照权威字段 —— 剔除 renderSegments（Rust 派生）与 Block.properties（属性表的解析副本）
function cloneSlim(src) {
  const blocks = src.blocks.map((b) => {
    const o = {}
    for (const k of SLIM_KEYS) o[k] = b[k]
    o.format = { ...b.format }
    return o
  })
  const properties = {}
  for (const k in src.properties) properties[k] = src.properties[k].map((p) => ({ ...p }))
  return { blocks, properties }
}

function bytesOf(v) {
  return Buffer.byteLength(JSON.stringify(v), 'utf8')
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function timeIt(fn, runs = 30) {
  const ts = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    ts.push(performance.now() - t0)
  }
  return median(ts)
}

function heapDelta(fn) {
  if (global.gc) global.gc()
  const before = process.memoryUsage().heapUsed
  const keep = fn()
  if (global.gc) global.gc()
  const after = process.memoryUsage().heapUsed
  return { mb: (after - before) / 1048576, keep }
}

const kb = (n) => (n / 1024).toFixed(0)
const pad = (s, w) => String(s).padStart(w)

console.log(`\n== ADR-0046 快照内存压力测试 ==  步数上限 ${STACK_STEPS}\n`)
console.log('页大小 | A.full | B.json | C.slim | slim/full | A深拷ms | C深拷ms | C x200 堆MB | 每块平均')
console.log('-------|--------|--------|--------|-----------|---------|---------|-------------|---------')
for (const n of PAGE_SIZES) {
  const page = makePage(n)
  const a = deepClone(page)
  const b = JSON.parse(JSON.stringify(page))
  const c = cloneSlim(page)
  const ab = bytesOf(a), bb = bytesOf(b), cb = bytesOf(c)
  const aMs = timeIt(() => deepClone(page))
  const cMs = timeIt(() => cloneSlim(page))
  const held = heapDelta(() => {
    const arr = []
    for (let i = 0; i < STACK_STEPS; i++) arr.push(cloneSlim(page))
    return arr
  })
  console.log(
    `${pad(n, 6)} | ${pad(kb(ab) + 'KB', 6)} | ${pad(kb(bb) + 'KB', 6)} | ${pad(kb(cb) + 'KB', 6)} | ` +
    `${pad(((cb / ab) * 100).toFixed(0) + '%', 9)} | ${pad(aMs.toFixed(1), 7)} | ${pad(cMs.toFixed(1), 7)} | ` +
    `${pad(held.mb.toFixed(1), 11)} | ${pad((cb / n).toFixed(0) + 'B', 8)}`
  )
  void held.keep
}

// D9 的关键风险：对权威状态做 deep watch。逐格测「初始深遍历 / 单块变更同步触发」，
// 并与「定时全量读 + 去重」这个替代观测点对照（同样不可能漏，但不付在每次按键上）。
console.log('\n== D9 观测点成本：deep watch vs 定时全量读 ==')
console.log('页大小 | deep watch 单次触发 ms(暖) | 一次全量读 ms | 轮询 CPU 占比(每500ms) | 触发次数')
console.log('-------|------------------------------|---------------|----------------------|---------')
for (const n of PAGE_SIZES) {
  const page = makePage(n)
  const blocks = ref(page.blocks)
  let hits = 0
  watch(blocks, () => { hits++ }, { deep: true, flush: 'sync' })
  const ts = []
  for (let i = 0; i < 40; i++) {
    const t = performance.now()
    blocks.value[i % n].content += 'x'
    ts.push(performance.now() - t)
  }
  const mutateMs = median(ts)
  const readMs = timeIt(() => { JSON.stringify(page).length })
  console.log(
    `${pad(n, 6)} | ${pad(mutateMs.toFixed(2), 28)} | ${pad(readMs.toFixed(2), 13)} | ` +
    `${pad(((readMs / 500) * 100).toFixed(2) + '%', 20)} | hits=${hits}`
  )
}

console.log('\n结论口径：')
console.log('- 一份 slim 快照（C）字节见上表；峰值内存 = C x 步数（200 步已列）。')
console.log('- A.full 含 renderSegments（Rust 派生）与 properties 解析副本 —— 按原样深拷是纯浪费。')
console.log('- deep watch 代价随块数线性增长且付在每次变更上；定时全量读同为 O(n) 但只付在固定节奏。\n')
