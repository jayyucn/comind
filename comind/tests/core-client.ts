import { initCoreClient, getCoreClient, type CoreClient } from '../src/wasm/client'

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
    await c.executeBatch([{
      entity: 'relationship_type',
      action: 'update',
      params: { id: t.id, deleted: 1 }
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
  const templates = await c.executeBatch([{
    entity: 'template',
    action: 'get',
    params: {}
  }])
  for (const t of templates) {
    if (t.success && t.id) {
      await c.executeBatch([{
        entity: 'template',
        action: 'delete',
        params: { id: t.id }
      }])
    }
  }
}

export async function cleanupPages(): Promise<void> {
  const c = await initTestCore()
  const pages = await c.getAllPages()
  for (const p of pages) {
    await c.deletePageCascade(p.id)
  }
}