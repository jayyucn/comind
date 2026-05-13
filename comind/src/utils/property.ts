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
        // YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
        // Try to parse and format
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return null
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
      }

      case 'datetime': {
        const dateStr = String(value).trim()
        const date = new Date(dateStr)
        if (isNaN(date.getTime())) return null
        return date.toISOString()
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

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(trimmed)) return 'datetime'

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return 'array'

  if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) return 'page'

  return 'string'
}
