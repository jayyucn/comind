import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>

  constructor() {
    super('comind')
    this.version(3).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
      pages: 'id, blockId, title, type, createdAt, updatedAt'
    })
  }
}

export const db = new ComindDB()
