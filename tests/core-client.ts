import { initCoreClient, type CoreClient } from '../src/wasm/client'

let client: CoreClient | null = null

export async function initTestCore(): Promise<CoreClient> {
  if (client) return client
  client = await initCoreClient()
  return client
}

export function getTestCore(): CoreClient | null {
  return client
}

export async function cleanupRelationshipTypes(): Promise<void> {
  const c = await initTestCore()
  const types = await c.getRelationshipTypes()
  for (const t of types) {
    // relationship_type/update 是「整行写入」契约（core services/batch.rs:414
    // 全量反序列化 RelationshipType），只发 { id, deleted } 会报
    // missing field `type` —— 必须补完整行。
    await c.executeBatch([{
      entity: 'relationship_type',
      action: 'update',
      params: {
        id: t.id,
        type: t.type,
        inverse: t.inverse,
        label: t.label,
        inverse_label: t.inverse_label,
        color: t.color,
        order: t.order,
        strength: t.strength,
        deleted: 1,
        builtin: t.builtin,
        created_at: t.created_at,
        updated_at: t.updated_at
      }
    }])
  }
  for (const t of types) {
    await c.executeBatch([{
      entity: 'relationship_type',
      action: 'delete',
      params: { id: t.id }
    }])
  }
}

export async function cleanupTemplates(): Promise<void> {
  const c = await initTestCore()
  // 必须用 getTemplates()（已解包 UserTemplate[]）；executeBatch get 返回
  // op results 数组（外层是 [[template...]]），直接遍历拿不到 id → 清理空转。
  const templates = await c.getTemplates()
  for (const t of templates) {
    await c.executeBatch([{
      entity: 'template',
      action: 'delete',
      params: { id: t.id }
    }])
  }
}

export async function cleanupPages(): Promise<void> {
  const c = await initTestCore()
  const pages = await c.getAllPages()
  for (const p of pages) {
    await c.deletePageCascade(p.id)
  }
}