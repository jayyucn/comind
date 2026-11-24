import type { PersistedFieldValue } from './tag-persisted'

/**
 * 字段值（库内 `field_value` 行的线上传输形状）。
 *
 * 与 `PersistedFieldValue` 的唯一差别是 `key`：它不是落库列，而是
 * `FieldDefinition.key` 的反规范化副本，由 Rust 服务层 join 定义表后填充。
 * 读路径拿到行后 `key` 恒为有效值；写入路径以 `key` 定位 `FieldDefinition`。
 */
export interface FieldValue extends PersistedFieldValue {
  key: string
}
