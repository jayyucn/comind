export interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null
  inverseRelationshipType: string | null
  createdAt: number
}

export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  relationshipType: string | null
  inverseRelationshipType: string | null
  createdAt: number
}
