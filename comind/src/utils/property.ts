import type { PropertyType, PropertyValue } from '../types/property'

/**
 * 格式化和验证属性值
 */
export function formatPropertyValue(
  value: any,
  type: PropertyType
): PropertyValue | null {
  try {
    switch (type) {
      case 'string':
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

      case 'array':
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
export function inferPropertyType(value: string): PropertyType {
  const trimmed = value.trim()

  if (trimmed === 'true' || trimmed === 'false') return 'boolean'

  if (/^\d+$/.test(trimmed) || /^\d+\.\d+$/.test(trimmed)) return 'number'

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'date'

  // page 类型检查必须在 array 类型之前，因为 [[页面名]] 同时满足 startsWith('[')
  if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) return 'page'

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return 'array'

  return 'string'
}
