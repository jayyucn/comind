import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord, PageRecord } from '../types/link'

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, number>
  pages!: Table<PageRecord, string>

  constructor() {
    super('comind')
    this.version(1).stores({
      blocks: 'id, parentId, pageId, left, createdAt, updatedAt',
      links: '++id, sourceBlockId, targetPageId, linkType',
      pages: 'id, title, createdAt, updatedAt'
    })
  }
}

export const db = new ComindDB()
