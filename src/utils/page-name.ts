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

/** 判据的一句话版本：置灰 tooltip 与校验失败提示共用同一份文案来源 */
export const PAGE_NAME_RULE_HINT = '含 | [ ] 或换行，或只有空白'

/** 单字符级的原因与替换建议（拒绝时给用户可执行的下一步，而不是一声「不行」） */
const CHAR_RULES: Record<string, { reason: string; replacement: string }> = {
  '|': { reason: '会被解析成别名分隔符（[[目标|别名]]）', replacement: '·' },
  '[': { reason: '方括号会截断 [[ ]] 引用语法', replacement: '（' },
  ']': { reason: '方括号会截断 [[ ]] 引用语法', replacement: '）' },
  '\n': { reason: '换行会把引用劈成两半', replacement: ' ' },
  '\r': { reason: '换行会把引用劈成两半', replacement: ' ' },
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
    return { ok: false, message: '页名不能为空', suggestion: null }
  }

  for (const ch of name) {
    const rule = CHAR_RULES[ch]
    if (!rule) continue
    const label = ch === '\n' || ch === '\r' ? '换行' : `「${ch}」`
    const suggestion = suggestPageName(name)
    return {
      ok: false,
      message: `页名不能含${label}：${rule.reason}`,
      suggestion: suggestion && suggestion !== name ? suggestion : null,
    }
  }

  return { ok: true, name }
}
