/**
 * 轻量表达式求值器（issue T11 公式字段）。
 *
 * 设计约束：
 * - **不使用 eval / Function**：用 shunting-yard 编译成 RPN 再迭代求值，杜绝代码注入。
 * - 表达式引用同块其它字段的 key（标识符）；未知/缺失引用按 0 处理（求值宽容，
 *   字段名拼写错误不炸读路径，渲染侧回落占位）。
 * - 支持：整数/小数、四则（+ - * / %）、一元负号、括号、函数（abs/min/max/round/sqrt/pow）。
 * - 求值结果经判别式联合 `{ ok, value } | { ok:false, error }` 返回，调用方据此校验/提示。
 *
 * 循环依赖由 `detectCycle` 在「保存公式定义」时静态检测并拒绝（求值本身靠静态 env
 * 快照 + 迭代 RPN 不会无限递归，自引用由 detectCycle 拦截）。
 */

/** 求值结果：成功带数值，失败带人类可读错误。 */
export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

type Tok =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'func'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' }
  | { t: 'neg' } // 一元负号
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

type RpnTok =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' }
  | { t: 'neg' }
  | { t: 'func'; v: string }
  | { t: 'argsep' }

/** RPN 栈里的参数分隔哨兵（与 number 不冲突：number 永不为字符串）。 */
const ARGSEP = '__argsep__'

/** 内建函数表（参数个数不校验，由实现容错）。 */
const FUNCS: Record<string, (args: number[]) => number> = {
  abs: ([x]) => Math.abs(x),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  round: ([x]) => Math.round(x),
  sqrt: ([x]) => Math.sqrt(x),
  pow: ([a, b]) => Math.pow(a, b),
}

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, neg: 3 }
const RIGHT_ASSOC = new Set(['neg'])

/** 词法分析：扫描出数字 / 标识符 / 函数名 / 运算符 / 括号 / 逗号。 */
function tokenize(input: string): { toks: Tok[]; error?: string } {
  const toks: Tok[] = []
  const s = input
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if ((c >= '0' && c <= '9') || (c === '.' && /[0-9]/.test(s[i + 1] ?? ''))) {
      let j = i + 1
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const num = Number(s.slice(i, j))
      if (Number.isNaN(num)) return { toks, error: `非法数字: ${s.slice(i, j)}` }
      toks.push({ t: 'num', v: num })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++
      const name = s.slice(i, j)
      let k = j
      while (k < s.length && (s[k] === ' ' || s[k] === '\t')) k++
      toks.push(s[k] === '(' ? { t: 'func', v: name } : { t: 'ident', v: name })
      i = j
      continue
    }
    if (c === '(') {
      toks.push({ t: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ t: 'rp' })
      i++
      continue
    }
    if (c === ',') {
      toks.push({ t: 'comma' })
      i++
      continue
    }
    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '%') {
      const prev = toks[toks.length - 1]
      const isUnary =
        c === '-' &&
        (prev === undefined ||
          prev.t === 'op' ||
          prev.t === 'lp' ||
          prev.t === 'comma' ||
          prev.t === 'neg')
      toks.push(isUnary ? { t: 'neg' } : { t: 'op', v: c as '+' | '-' | '*' | '/' | '%' })
      i++
      continue
    }
    return { toks, error: `非法字符: ${c}` }
  }
  return { toks }
}

/** shunting-yard：中缀 token 序列 → RPN（函数参数以 argsep 间隔）。 */
function toRpn(toks: Tok[]): { rpn: RpnTok[]; error?: string } {
  const out: RpnTok[] = []
  const stack: (Tok & { t: 'op' | 'neg' | 'func' | 'lp' | 'comma' })[] = []
  for (const tok of toks) {
    switch (tok.t) {
      case 'num':
        out.push({ t: 'num', v: tok.v })
        break
      case 'ident':
        out.push({ t: 'ident', v: tok.v })
        break
      case 'func':
        stack.push(tok)
        break
      case 'comma':
        while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(popOp(stack))
        if (!stack.length || stack[stack.length - 1].t !== 'lp') return { rpn: out, error: '括号不匹配' }
        out.push({ t: 'argsep' })
        break
      case 'lp':
        stack.push(tok)
        break
      case 'rp': {
        while (stack.length && stack[stack.length - 1].t !== 'lp') out.push(popOp(stack))
        if (!stack.length || stack[stack.length - 1].t !== 'lp') return { rpn: out, error: '括号不匹配' }
        stack.pop() // 丢弃 lp
        if (stack.length && stack[stack.length - 1].t === 'func') out.push(popOp(stack) as RpnTok)
        break
      }
      case 'op':
      case 'neg': {
        const curPrec = PREC[tok.t === 'op' ? tok.v : 'neg']
        while (stack.length) {
          const top = stack[stack.length - 1]
          if (top.t === 'lp' || top.t === 'comma') break
          if (top.t === 'func') {
            out.push(popOp(stack))
            continue
          }
          const topPrec = PREC[top.t === 'op' ? top.v : 'neg']
          if (topPrec > curPrec || (topPrec === curPrec && !RIGHT_ASSOC.has(tok.t))) out.push(popOp(stack))
          else break
        }
        stack.push(tok)
        break
      }
    }
  }
  while (stack.length) {
    const top = stack.pop()!
    if (top.t === 'lp') return { rpn: out, error: '括号不匹配' }
    out.push(top as RpnTok)
  }
  return { rpn: out }
}

/** 栈顶运算符出栈（仅用于 op/neg/func）。 */
function popOp(stack: (Tok & { t: 'op' | 'neg' | 'func' | 'lp' | 'comma' })[]): RpnTok {
  const top = stack.pop()!
  if (top.t === 'op') return { t: 'op', v: top.v }
  if (top.t === 'neg') return { t: 'neg' }
  return { t: 'func', v: (top as { v: string }).v }
}

/** 迭代求值 RPN。 */
function evalRpn(rpn: RpnTok[], env: Record<string, number>): FormulaResult {
  const st: (number | typeof ARGSEP)[] = []
  for (const tok of rpn) {
    if (tok.t === 'num') {
      st.push(tok.v)
    } else if (tok.t === 'ident') {
      const v = env[tok.v]
      st.push(typeof v === 'number' && !Number.isNaN(v) ? v : 0)
    } else if (tok.t === 'neg') {
      const a = st.pop()
      if (typeof a !== 'number') return { ok: false, error: '表达式不完整' }
      st.push(-a)
    } else if (tok.t === 'op') {
      const b = st.pop()
      const a = st.pop()
      if (typeof a !== 'number' || typeof b !== 'number') return { ok: false, error: '表达式不完整' }
      switch (tok.v) {
        case '+':
          st.push(a + b)
          break
        case '-':
          st.push(a - b)
          break
        case '*':
          st.push(a * b)
          break
        case '/':
          if (b === 0) return { ok: false, error: '除以零' }
          st.push(a / b)
          break
        case '%':
          if (b === 0) return { ok: false, error: '取模零' }
          st.push(a % b)
          break
      }
    } else if (tok.t === 'func') {
      const groups: number[][] = []
      let cur: number[] = []
      while (st.length) {
        const x = st.pop()!
        if (x === ARGSEP) {
          groups.unshift(cur)
          cur = []
          continue
        }
        cur.unshift(x)
      }
      groups.unshift(cur)
      const fn = FUNCS[tok.v]
      if (!fn) return { ok: false, error: `未知函数: ${tok.v}` }
      st.push(fn(groups.flat()))
    }
    // argsep 不会单独出现（只在函数求值前被消费）
  }
  if (st.length !== 1 || typeof st[0] !== 'number') return { ok: false, error: '表达式不完整' }
  return { ok: true, value: st[0] }
}

/**
 * 求值公式表达式。
 * @param expr 表达式字符串（如 `"price * qty"`、`"abs(a - b)"`）
 * @param env 字段 key → 数值 的映射（同块兄弟字段的数值）
 * @returns 成功带数值；解析/求值失败带 error
 */
export function evaluateFormula(expr: string, env: Record<string, number>): FormulaResult {
  const { toks, error } = tokenize(expr)
  if (error) return { ok: false, error }
  const { rpn, error: rpnError } = toRpn(toks)
  if (rpnError) return { ok: false, error: rpnError }
  return evalRpn(rpn, env)
}

/**
 * 结构完整性检查（仅校验操作数个数/括号配对，不求值、不因缺失引用或除零报错）：
 * 用占位操作数模拟 RPN 执行，检测「表达式不完整」（如 `1 +` 残留运算符）。
 */
function checkStructure(rpn: RpnTok[]): string | null {
  const st: number[] = []
  for (const tok of rpn) {
    if (tok.t === 'num' || tok.t === 'ident') {
      st.push(0)
    } else if (tok.t === 'argsep') {
      st.push(NaN)
    } else if (tok.t === 'neg') {
      if (st.length < 1) return '表达式不完整'
      st.pop()
      st.push(0)
    } else if (tok.t === 'op') {
      if (st.length < 2) return '表达式不完整'
      st.pop()
      st.pop()
      st.push(0)
    } else if (tok.t === 'func') {
      const groups: number[][] = []
      let cur: number[] = []
      while (st.length) {
        const x = st.pop()!
        if (Number.isNaN(x)) {
          groups.unshift(cur)
          cur = []
          continue
        }
        cur.unshift(x)
      }
      groups.unshift(cur)
      st.push(0)
    }
  }
  if (st.length !== 1 || Number.isNaN(st[0] as number)) return '表达式不完整'
  return null
}

/**
 * 仅解析校验（不求值）：语法合法返回 ok，否则带错误文案（供编辑器 canSave 拦截）。
 * 缺失字段引用（按 0 处理）与除零属运行时语义，不在此拦截。
 */
export function validateFormula(expr: string): { ok: true } | { ok: false; error: string } {
  const { toks, error } = tokenize(expr)
  if (error) return { ok: false, error }
  const { rpn, error: rpnError } = toRpn(toks)
  if (rpnError) return { ok: false, error: rpnError }
  const structError = checkStructure(rpn)
  if (structError) return { ok: false, error: structError }
  return { ok: true }
}

/**
 * 收集表达式引用到的字段 key（标识符，排除函数名）。
 * 用于循环依赖检测与依赖关系展示。
 */
export function collectReferences(expr: string): string[] {
  const { toks } = tokenize(expr)
  const refs = new Set<string>()
  for (const t of toks) if (t.t === 'ident') refs.add(t.v)
  return [...refs]
}

/**
 * 循环依赖检测（保存公式定义前调用）。
 * @param nodes 一组公式字段（key + 表达式）；边 A→B 当 A 的表达式引用 B 且 B 也是公式字段。
 * @returns 若存在环，返回环路径（如 `['A','B','A']` 或自引用 `['A','A']`）；否则 null。
 */
export function detectCycle(nodes: { key: string; formula: string }[]): string[] | null {
  const formulas = new Set(nodes.map((n) => n.key))
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    const refs = collectReferences(n.formula).filter((r) => formulas.has(r))
    adj.set(n.key, refs)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const k of formulas) color.set(k, WHITE)
  let cycle: string[] | null = null

  const dfs = (u: string, stack: string[]): void => {
    color.set(u, GRAY)
    stack.push(u)
    for (const v of adj.get(u) ?? []) {
      if (cycle) return
      const c = color.get(v)
      if (c === GRAY) {
        const idx = stack.indexOf(v)
        cycle = stack.slice(idx)
        cycle.push(v)
        return
      }
      if (c === WHITE) dfs(v, stack)
    }
    color.set(u, BLACK)
    stack.pop()
  }

  for (const k of formulas) {
    if (color.get(k) === WHITE) {
      dfs(k, [])
      if (cycle) break
    }
  }
  return cycle
}

/**
 * 渲染侧便捷封装：求值失败（含缺失字段）回退 null，由调用方回落占位。
 */
export function safeEvaluateFormula(expr: string, env: Record<string, number>): number | null {
  const r = evaluateFormula(expr, env)
  return r.ok ? r.value : null
}
