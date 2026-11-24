/**
 * 页名约束（建链准入）—— 单一权威实现。
 *
 * 定义落点见 `docs/3-features/link-spec.md`「页名约束（建链准入）」。规则只约束
 * **能写进 `[[ ]]` 的名字**，不改变已存在页面的标题，也不做存量清洗：
 *
 * - `trim` 后非空；
 * - 不含 `[`、`]`、`|`、换行。
 *
 * 三条禁止都来自解析器的硬边界，而不是审美：
 * - `]` 会提前闭合 `[[ ]]`，剩下的 `XX]]` 变成普通文字（静默断链）；
 * - `|` 是别名分隔符，`[[A|B]]` 的目标是 `A`，页名里的 `|` 之后永不生效；
 * - 换行会把 `[[..]]` 劈成两段，两段都不再是链接。
 *
 * 允许 `#`、空格、中文、emoji —— 与 Rust 侧 `RE_INTERNAL`（`[^\]|]+?`）一致，
 * 存量数据零影响。
 */

/** 单字符级的原因与替换建议（拒绝时给用户可执行的下一步，而不是一声「不行」） */
const CHAR_RULES: Record<string, { reason: string; replacement: string }> = {
  '|': { reason: '会被解析成别名分隔符（[[目标|别名]]）', replacement: '·' },
  '[': { reason: '方括号会截断 [[ ]] 引用语法', replacement: '（' },
  ']': { reason: '方括号会截断 [[ ]] 引用语法', replacement: '）' },
  '\n': { reason: '换行会把引用劈成两半', replacement: ' ' },
  '\r': { reason: '换行会把引用劈成两半', replacement: ' ' },
}

/** 违规字符在提示里的写法：`[` → 「[」，换行 → 换行（不是「\n」） */
function charLabel(ch: string): string {
  return ch === '\n' || ch === '\r' ? '换行' : `「${ch}」`
}

export interface PageNameValid {
  ok: true
  /** 判据归一后的页名（`trim` 之后） */
  name: string
}

export interface PageNameInvalid {
  ok: false
  /** 给用户看的具体原因（含违规字符） */
  message: string
  /** 违规字符（去重、按首次出现顺序；换行统一归一为 `\n`） */
  chars: string[]
  /** 把违规字符替换后得到的建议名；与原名相同则为 null */
  suggestion: string | null
}

export type PageNameCheck = PageNameValid | PageNameInvalid

/** 按规则清洗出一个可用的页名（只用于「建议」，不静默替换用户输入） */
export function suggestPageName(raw: string): string {
  let out = ''
  for (const ch of raw) {
    out += CHAR_RULES[ch]?.replacement ?? ch
  }
  return out.trim()
}

/**
 * 校验一个候选页名。
 *
 * 返回结构刻意包含 `suggestion`：创建/重命名被拦时，UI 要能给出
 * 「把 `|` 换成 `·` 后可用：项目A·旧名」，而不是只丢一句错误。
 */
export function validatePageName(raw: string): PageNameCheck {
  const name = raw.trim()
  if (!name) {
    return { ok: false, message: '页名不能为空', chars: [], suggestion: null }
  }

  const chars = collectForbiddenChars(name)
  if (chars.length > 0) {
    const rule = CHAR_RULES[chars[0]!]!
    const suggestion = suggestPageName(name)
    return {
      ok: false,
      message: `页名不能含${charLabel(chars[0]!)}：${rule.reason}`,
      chars,
      suggestion: suggestion && suggestion !== name ? suggestion : null,
    }
  }

  return { ok: true, name }
}

/** 收集全部违规字符（去重保序，换行归一）—— 一次改完，不让用户逐个试 */
function collectForbiddenChars(name: string): string[] {
  const chars: string[] = []
  for (const ch of name) {
    if (!CHAR_RULES[ch]) continue
    const normalized = ch === '\r' ? '\n' : ch
    if (!chars.includes(normalized)) chars.push(normalized)
  }
  return chars
}

/** 提示里最多点名的字符数；再多就收成「等」，避免 tooltip 过长难读 */
const MAX_NAMED_CHARS = 3

/**
 * 「这段选区为什么不能当页名」—— 置灰 tooltip 的文案来源。
 *
 * 只写**具体**原因：不说「含非法字符」，直接点名 `[`；不说「选区不可用」，
 * 直接说是空、是换行、还是哪个字符。用户看完就知道改哪里，不必退出去试。
 * 合法返回 `null`（调用方据此判断可点）。
 *
 * 刻意**不给替换建议**：创建/重命名场景建议 `[` → `（` 是对的（用户本来就要那个
 * 名字），但包裹场景里用户选中的是 `[页面`，他想要的通常是「页面」而不是
 * 「（页面」——建议会把人引到更远的地方。建议只留在弹窗里。
 */
export function pageNameRejectionHint(raw: string): string | null {
  const check = validatePageName(raw)
  if (check.ok) return null
  if (check.chars.length === 0) return '选区不能作为页面名，选区只有空白'

  const labels = check.chars.slice(0, MAX_NAMED_CHARS).map(charLabel).join('')
  const more = check.chars.length > MAX_NAMED_CHARS ? '等' : ''
  return `选区不能作为页面名，不能包含${labels}${more}`
}
