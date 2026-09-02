// 阅读器排版偏好（票 04 / ADR-0040 D6）：字号/行距/行宽/主题。
// 阅读器本地偏好（非知识数据，不进库），localStorage 持久化，跨会话记住。
// 模块级单例（同 useEditorSettings 模式）；CSS 变量的落地由 ReaderView
// 写到阅读器窗口根元素（作用域限定在阅读器，不污染主文档根）。
import { computed, ref } from 'vue'

export type ReaderTheme = 'light' | 'sepia' | 'dark'

/** 排版参数（数值经 clamp 保证合法区间） */
export interface ReaderTypography {
  /** 正文字号 px（14–24） */
  fontSize: number
  /** 正文行距（1.4–2.4） */
  lineHeight: number
  /** 正文行宽 ch（28–56，中文理想行长约 35–45 字） */
  maxWidthCh: number
  /** 主题：浅色 / 护眼米黄 / 夜间反转 */
  theme: ReaderTheme
}

const STORAGE_KEY = 'comind-reader-typography'

const DEFAULTS: ReaderTypography = {
  fontSize: 17,
  lineHeight: 1.8,
  maxWidthCh: 42,
  theme: 'light',
}

const LIMITS = {
  fontSize: [14, 24],
  lineHeight: [1.4, 2.4],
  maxWidthCh: [28, 56],
} as const

const THEMES: readonly ReaderTheme[] = ['light', 'sepia', 'dark']

function clampNum(value: unknown, [min, max]: readonly [number, number], fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

function isTheme(value: unknown): value is ReaderTheme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/** 从 localStorage 恢复（损坏/缺失/越界值回退默认） */
function loadTypography(): ReaderTypography {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULTS }
    const raw = JSON.parse(stored) as Partial<ReaderTypography>
    return {
      fontSize: clampNum(raw.fontSize, LIMITS.fontSize, DEFAULTS.fontSize),
      lineHeight: clampNum(raw.lineHeight, LIMITS.lineHeight, DEFAULTS.lineHeight),
      maxWidthCh: clampNum(raw.maxWidthCh, LIMITS.maxWidthCh, DEFAULTS.maxWidthCh),
      theme: isTheme(raw.theme) ? raw.theme : DEFAULTS.theme,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveTypography(value: ReaderTypography): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级为仅内存态
  }
}

const typography = ref<ReaderTypography>(loadTypography())

export function useReaderTypography() {
  /** 局部更新（经 clamp 合法化后写内存 + localStorage） */
  function updateTypography(patch: Partial<ReaderTypography>): void {
    const next: ReaderTypography = {
      fontSize: clampNum(patch.fontSize ?? typography.value.fontSize, LIMITS.fontSize, typography.value.fontSize),
      lineHeight: clampNum(patch.lineHeight ?? typography.value.lineHeight, LIMITS.lineHeight, typography.value.lineHeight),
      maxWidthCh: clampNum(patch.maxWidthCh ?? typography.value.maxWidthCh, LIMITS.maxWidthCh, typography.value.maxWidthCh),
      theme: isTheme(patch.theme) ? patch.theme : typography.value.theme,
    }
    typography.value = next
    saveTypography(next)
  }

  /** 步进：字号 ±2 / 行距 ±0.1 / 行宽 ±4，越界钳制 */
  function stepFontSize(delta: number): void {
    updateTypography({ fontSize: typography.value.fontSize + delta * 2 })
  }

  function stepLineHeight(delta: number): void {
    updateTypography({ lineHeight: Math.round((typography.value.lineHeight + delta * 0.1) * 10) / 10 })
  }

  function stepMaxWidth(delta: number): void {
    updateTypography({ maxWidthCh: typography.value.maxWidthCh + delta * 4 })
  }

  return {
    typography: computed(() => typography.value),
    updateTypography,
    stepFontSize,
    stepLineHeight,
    stepMaxWidth,
  }
}
