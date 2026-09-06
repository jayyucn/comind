/**
 * 前端镜像 `crates/comind-core/src/utils/date_parser.rs` 的「日期输入」语法子集。
 *
 * 用途：DatePicker 面板允许键入 `今天 / +3 / 下周一 / 2026-09-06` 等相对日期表达式，
 * 解析为 `YYYY-MM-DD` 后直接落库到 Condition.value（前置解析 = UI 层方案，
 * 不污染 ConditionValue 类型与 evaluate/serialize）。
 *
 * 与 Rust 端语义的同步约束：
 * - 两者语法集合必须一致；当 Rust 端新增日期语法，需同步补一个分支。
 * - 两者解析结果必须一致；任一端语义微调都要更新另一端与测试用例。
 * - 不复制 Rust 端的 `parse_date_time_input`（DatePicker 是 day 粒度，不需要时间）。
 *
 * 输出：`YYYY-MM-DD` 或 `null`（无法识别 / 空串）。
 */

/** 把 `Date` 序列化为本地时区的 `YYYY-MM-DD`（与 chrono Local::now().date_naive() 一致）。 */
function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 在 `base` 上加 `days` 天，返回新的本地 Date（不修改原对象）。 */
function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

/** 中文星期字符 → 周一=1...周日=0（与 Rust 端 weekday_index 对齐）。 */
function weekdayIndexCN(s: string): number | null {
  switch (s) {
    case '日':
    case '天':
      return 0
    case '一':
      return 1
    case '二':
      return 2
    case '三':
      return 3
    case '四':
      return 4
    case '五':
      return 5
    case '六':
      return 6
    default:
      return null
  }
}

/**
 * 相对日期解析。返回 `YYYY-MM-DD` 或 `null`。
 *
 * 支持的语法（顺序匹配，命中即返回）：
 * - `today` / `今天`
 * - `tomorrow` / `明天`
 * - `yesterday` / `昨天`
 * - `+N` / `-N` / `+Nd` / `-Nd` / `+N days`
 * - `YYYY-MM-DD`（2000..=2100，年月日合法）
 * - `MM-DD`（同一年的 MM-DD；若已过去则取下一年）
 * - `周X` / `星期X` / `下周X` / `下星期X`（X: 日/天 一二三四五六）
 *
 * 不区分大小写；前后空格会被忽略。
 */
export function parseRelativeDate(input: string, now: Date = new Date()): string | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // ── today / tomorrow / yesterday（中文优先大小写不敏感已含）──
  if (trimmed === 'today' || input.trim() === '今天') return toIsoLocal(now)
  if (trimmed === 'tomorrow' || input.trim() === '明天') return toIsoLocal(addDays(now, 1))
  if (trimmed === 'yesterday' || input.trim() === '昨天') return toIsoLocal(addDays(now, -1))

  // ── +N / -N / +Nd / +N days ──
  const relMatch = /^([+-]?\d+)\s*(d|day|days)?$/.exec(trimmed)
  if (relMatch) {
    const days = Number(relMatch[1])
    if (!Number.isFinite(days)) return null
    return toIsoLocal(addDays(now, days))
  }

  // ── YYYY-MM-DD ──
  const fullMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim())
  if (fullMatch) {
    const y = Number(fullMatch[1])
    const mo = Number(fullMatch[2])
    const d = Number(fullMatch[3])
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
    const dt = new Date(y, mo - 1, d)
    // 防止 Date 溢出（2 月 30 日会被规范化为 3 月 2 日）
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    return toIsoLocal(dt)
  }

  // ── MM-DD（输入「07-15」这种）──
  // 注意：必须在 YYYY-MM-DD 之后判，否则 `-` 太多会被前面的 YYYY 分支吃掉一部分
  const partialMatch = /^(\d{1,2})-(\d{1,2})$/.exec(input.trim())
  if (partialMatch) {
    const mo = Number(partialMatch[1])
    const d = Number(partialMatch[2])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    let dt = new Date(now.getFullYear(), mo - 1, d)
    if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null
    // 已过去（含今天）→ 取下一年（与 Rust 端语义一致）
    if (toIsoLocal(dt) < toIsoLocal(now)) {
      dt = new Date(dt.getFullYear() + 1, mo - 1, d)
    }
    return toIsoLocal(dt)
  }

  // ── 中文/前缀周X ──
  const weekMatch = /^(下?周|下?星期)([日天一二三四五六])$/.exec(input.trim())
  if (weekMatch) {
    const isNextWeek = weekMatch[1].startsWith('下')
    const target = weekdayIndexCN(weekMatch[2])
    if (target === null) return null

    // 本/上周的同一日（Rust: days_back = (todayWeekday - target + 7) % 7）
    // JS: getDay() = 周日=0, 周一=1...周六=6；转为 num_from_monday = (getDay()+6)%7
    const todayFromMonday = (now.getDay() + 6) % 7
    const targetFromMonday = (target + 6) % 7
    const daysBack = (todayFromMonday - targetFromMonday + 7) % 7
    let thisWeek = addDays(now, -daysBack)

    if (isNextWeek) {
      thisWeek = addDays(thisWeek, 7)
    } else if (toIsoLocal(thisWeek) <= toIsoLocal(now)) {
      // 本周该日已过或就是今天 → 推到下周（与 Rust L193-196 一致）
      thisWeek = addDays(thisWeek, 7)
    }
    return toIsoLocal(thisWeek)
  }

  return null
}

/**
 * 给 7 个 DatePicker 快捷按钮用的「相对锚点」——返回今天、本周/本月起止。
 * 与 parseRelativeDate 共享同一份时区/序列化逻辑，避免重复实现。
 */
export function relativeDateShortcuts(now: Date = new Date()): {
  today: string
  yesterday: string
  tomorrow: string
  weekStart: string
  weekEnd: string
  monthStart: string
  monthEnd: string
} {
  const todayStr = toIsoLocal(now)
  const y = now.getFullYear()
  const m = now.getMonth()

  // 本周一（ISO 周首日）
  const fromMonday = (now.getDay() + 6) % 7
  const weekStartDt = addDays(now, -fromMonday)
  const weekEndDt = addDays(weekStartDt, 6)

  // 本月初 / 本月末（月底：day=0 自动取下月最后一天 = 本月末）
  const monthStartDt = new Date(y, m, 1)
  const monthEndDt = new Date(y, m + 1, 0)

  return {
    today: todayStr,
    yesterday: toIsoLocal(addDays(now, -1)),
    tomorrow: toIsoLocal(addDays(now, 1)),
    weekStart: toIsoLocal(weekStartDt),
    weekEnd: toIsoLocal(weekEndDt),
    monthStart: toIsoLocal(monthStartDt),
    monthEnd: toIsoLocal(monthEndDt),
  }
}

/* ─────────────────────────────────────────────
 * 动态日期表达式（relativeDate ConditionValue）
 * ─────────────────────────────────────────────
 * 查询条件支持「动态值」：值落库为相对表达式 token，evaluate 每次求值时刻
 * resolve 成当天日期——页面每次打开/数据变化即重算，实现"跟着今天走"。
 * - 快捷按钮用 7 个固定 expr（本文件词表）
 * - 键入的自由语法（今天/+3/下周一…）直接以原文为 expr，交给 resolveRelativeExpr
 * 词表与 Rust date_parser.rs 无直接对应（这是查询层新增概念），但 resolve 目标
 * 必须与 parseRelativeDate 的锚定语义一致（本地时区、周起 ISO 周一）。
 */

/** 快捷动态值 → 表达式 token（与 {@link relativeDateShortcuts} 的键一一对应）。 */
export const RELATIVE_EXPRS = [
  'today',
  'yesterday',
  'tomorrow',
  'weekStart',
  'weekEnd',
  'monthStart',
  'monthEnd',
] as const

/** 动态 token → 中文展示（查询芯片 / DatePicker 触发器）。 */
export function formatRelativeExpr(expr: string): string {
  switch (expr) {
    case 'today':
      return '今日'
    case 'yesterday':
      return '昨日'
    case 'tomorrow':
      return '明日'
    case 'weekStart':
      return '本周起始'
    case 'weekEnd':
      return '本周末'
    case 'monthStart':
      return '本月初'
    case 'monthEnd':
      return '本月末'
    default:
      // 键入的自由语法直接回显原文
      return expr
  }
}

/** 判定字符串是不是「相对日期 token 集内」的快捷词。 */
export function isRelativeToken(s: string): boolean {
  return (RELATIVE_EXPRS as readonly string[]).includes(s)
}

/**
 * 动态相对表达式 → 具体 `YYYY-MM-DD`（以 now 为锚，默认当前时刻）。
 *
 * 优先级：快捷 token（today/weekStart/...）→ 走 relativeDateShortcuts 同语义实现；
 * 其余按自由键入语法（今天/+3/下周一/MM-DD…）交给 parseRelativeDate。
 * 识别失败返回 null（调用方按「目标为空」处理，即该条件不匹配）。
 */
export function resolveRelativeExpr(expr: string, now: Date = new Date()): string | null {
  const key = expr.trim() as keyof ReturnType<typeof relativeDateShortcuts>
  if (isRelativeToken(key)) {
    return relativeDateShortcuts(now)[key] ?? null
  }
  return parseRelativeDate(expr, now)
}

