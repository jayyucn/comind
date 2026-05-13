import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>

  constructor() {
    super('comind')
    this.version(4).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
      pages: 'id, blockId, title, type, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]'
    })
  }
}

export const db = new ComindDB()
