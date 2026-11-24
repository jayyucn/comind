import type { FieldType, FieldValueData } from '../types/field-definition'

/**
 * 格式化和验证字段值
 */
export function formatFieldValueData(
  value: FieldValueData,
  type: FieldType
): FieldValueData | null {
  try {
    switch (type) {
      // string / select：值即字符串（select 存选项 id），留白修剪即可
      case 'string':
      case 'select':
        return String(value).trim()

      case 'number': {
        const num = Number(value)
        if (isNaN(num)) return null
        return num
      }

      case 'boolean':
        if (typeof value === 'boolean') return value
        if (value === 'true') return true
        if (value === 'false') return false
        return null

      case 'date': {
        const dateStr = String(value).trim()
        // YYYY-MM-DD or YYYY-MM-DDTHH:mm format
        if (dateStr.length >= 10) {
          const d = new Date(dateStr)
          if (!isNaN(d.getTime())) return dateStr.slice(0, 10)
        }
        return null
      }

      // datetime（yyyy-MM-dd HH:mm，ADR-0041）：兼容 T/空格两种分隔，统一规范化为空格。
      // 校验解析前把空格换 'T'——'yyyy-MM-dd HH:mm' 空格形不是跨引擎可解析格式（Safari 返回 NaN），
      // 'yyyy-MM-ddTHH:mm' 才是 ES 规范格式。
      case 'datetime': {
        const dateStr = String(value).trim()
        if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(dateStr)) {
          const d = new Date(`${dateStr.slice(0, 10)}T${dateStr.slice(11, 16)}`)
          if (!isNaN(d.getTime())) return `${dateStr.slice(0, 10)} ${dateStr.slice(11, 16)}`
        }
        return null
      }

      // multiSelect：值域与 array 同为字符串数组，同族解析
      case 'multiSelect':
      case 'array': {
        if (Array.isArray(value)) {
          return value.map(v => String(v).trim()).filter(Boolean)
        }
        // If it's a string like "[a, b, c]", parse it
        const str = String(value).trim()
        if (str.startsWith('[') && str.endsWith(']')) {
          return str.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        }
        // Otherwise treat as single-item array
        return [String(value).trim()].filter(Boolean)
      }

      case 'page':
        // Page reference is just a string ID or title
        return String(value).trim()

      default:
        return String(value).trim()
    }
  } catch {
    return null
  }
}

/**
 * 推断值类型（根据字符串）
 */
export function inferFieldType(value: string): FieldType {
  const trimmed = value.trim()

  if (trimmed === 'true' || trimmed === 'false') return 'boolean'

  if (/^\d+$/.test(trimmed) || /^\d+\.\d+$/.test(trimmed)) return 'number'

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'date'

  // page 类型检查必须在 array 类型之前，因为 [[页面名]] 同时满足 startsWith('[')
  if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) return 'page'

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return 'array'

  return 'string'
}
