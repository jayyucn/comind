import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'
import type { Asset } from '../types/asset'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>
  assets!: Table<Asset, string>

  constructor() {
    super('comind')
    this.version(7).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, createdAt, relationshipType, inverseRelationshipType',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id'
    }).upgrade(async (tx) => {
      // 为现有链接添加默认值
      const linksTable = tx.table('links') as Table<LinkRecord, string>
      const links = await linksTable.toArray()
      for (const link of links) {
        const typedLink = link as Partial<LinkRecord>
        if (!('relationshipType' in typedLink)) {
          await linksTable.update(typedLink.id as string, {
            relationshipType: null,
            inverseRelationshipType: null
          })
        }
      }
    })
  }
}

export const db = new ComindDB()
