import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PropertyService } from './property'

vi.mock('../storage/indexedDB', () => ({
  storage: {
    getProperties: vi.fn(),
    getProperty: vi.fn(),
    getPropertiesByBlockIds: vi.fn(),
    saveProperty: vi.fn(),
    deleteProperty: vi.fn(),
    hardDeleteProperty: vi.fn(),
    deletePropertiesByBlockId: vi.fn(),
    getPropertyById: vi.fn()
  }
}))

vi.mock('../utils/id', () => ({
  generateUUID: vi.fn().mockReturnValue('mock-uuid')
}))

vi.mock('../types/property', () => ({
  getPropertyDefinition: vi.fn(),
  getAllPropertyDefinitions: vi.fn().mockReturnValue([])
}))

vi.mock('../utils/property', () => ({
  formatPropertyValue: vi.fn((value) => value)
}))

describe('PropertyService', () => {
  let service: PropertyService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new PropertyService()
  })

  describe('getProperties', () => {
    it('returns all properties for a block', async () => {
      const mockProperties = [
        { id: 'p1', blockId: 'b1', key: 'status', value: 'todo', type: 'string' as const, sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0, updatedAt: 0 },
        { id: 'p2', blockId: 'b1', key: 'priority', value: 'high', type: 'string' as const, sortOrder: 1, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0, updatedAt: 0 }
      ]

      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperties as any).mockResolvedValueOnce(mockProperties)

      const result = await service.getProperties('b1')
      expect(result).toEqual(mockProperties)
      expect(storage.getProperties).toHaveBeenCalledWith('b1')
    })
  })

  describe('getProperty', () => {
    it('returns specific property', async () => {
      const mockProperty = {
        id: 'p1',
        blockId: 'b1',
        key: 'status',
        value: 'todo',
        type: 'string' as const,
        sortOrder: 0,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 0
      }

      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(mockProperty)

      const result = await service.getProperty('b1', 'status')
      expect(result).toEqual(mockProperty)
    })

    it('returns undefined for non-existent property', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(undefined)

      const result = await service.getProperty('b1', 'non-existent')
      expect(result).toBeUndefined()
    })
  })

  describe('getPropertiesByBlockIds', () => {
    it('returns properties for multiple blocks', async () => {
      const mockMap = new Map([
        ['b1', [{ id: 'p1', blockId: 'b1', key: 'status', value: 'todo', type: 'string' as const, sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0, updatedAt: 0 }]],
        ['b2', [{ id: 'p2', blockId: 'b2', key: 'priority', value: 'high', type: 'string' as const, sortOrder: 0, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0, updatedAt: 0 }]]
      ])

      const { storage } = await import('../storage/indexedDB')
      ;(storage.getPropertiesByBlockIds as any).mockResolvedValueOnce(mockMap)

      const result = await service.getPropertiesByBlockIds(['b1', 'b2'])
      expect(result).toEqual(mockMap)
    })
  })

  describe('setProperty - create new', () => {
    it('creates new property when none exists', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(undefined)
      ;(storage.getProperties as any).mockResolvedValueOnce([])
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      const result = await service.setProperty('b1', 'status', 'todo')

      expect(result.key).toBe('status')
      expect(result.value).toBe('todo')
      expect(result.blockId).toBe('b1')
      expect(storage.saveProperty).toHaveBeenCalled()
    })

    it('calculates correct sortOrder for new property', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(undefined)
      ;(storage.getProperties as any).mockResolvedValueOnce([
        { id: 'p1', sortOrder: 0 },
        { id: 'p2', sortOrder: 1 }
      ])
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      await service.setProperty('b1', 'new', 'value')

      const savedProperty = (storage.saveProperty as any).mock.calls[0][0]
      expect(savedProperty.sortOrder).toBe(2)
    })
  })

  describe('setProperty - update existing', () => {
    it('updates existing property', async () => {
      const existingProperty = {
        id: 'p1',
        blockId: 'b1',
        key: 'status',
        value: 'done',
        type: 'string' as const,
        sortOrder: 0,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 1000,
        updatedAt: 1000
      }

      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(existingProperty)
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      const result = await service.setProperty('b1', 'status', 'todo')

      expect(result.value).toBe('todo')
      expect(result.id).toBe('p1')
      expect(storage.saveProperty).toHaveBeenCalled()
    })

    it('preserves sortOrder on update', async () => {
      const existingProperty = {
        id: 'p1',
        blockId: 'b1',
        key: 'status',
        value: 'done',
        type: 'string' as const,
        sortOrder: 5,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 1000,
        updatedAt: 1000
      }

      const { storage } = await import('../storage/indexedDB')
      ;(storage.getProperty as any).mockResolvedValueOnce(existingProperty)
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      await service.setProperty('b1', 'status', 'todo')

      const savedProperty = (storage.saveProperty as any).mock.calls[0][0]
      expect(savedProperty.sortOrder).toBe(5)
    })
  })

  describe('deleteProperty', () => {
    it('soft deletes property', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.deleteProperty as any).mockResolvedValueOnce(undefined)

      await service.deleteProperty('p1')

      expect(storage.deleteProperty).toHaveBeenCalledWith('p1')
    })
  })

  describe('hardDeleteProperty', () => {
    it('hard deletes property', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.hardDeleteProperty as any).mockResolvedValueOnce(undefined)

      await service.hardDeleteProperty('p1')

      expect(storage.hardDeleteProperty).toHaveBeenCalledWith('p1')
    })
  })

  describe('deletePropertiesByBlockId', () => {
    it('cascades delete to all block properties', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.deletePropertiesByBlockId as any).mockResolvedValueOnce(undefined)

      await service.deletePropertiesByBlockId('b1')

      expect(storage.deletePropertiesByBlockId).toHaveBeenCalledWith('b1')
    })
  })

  describe('updateSortOrder', () => {
    it('updates sortOrder for all properties', async () => {
      const { storage } = await import('../storage/indexedDB')
      const properties = [
        { id: 'p1', sortOrder: 0, updatedAt: 1000, blockId: 'b1', key: 'a', value: 'v1', type: 'string' as const, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0 },
        { id: 'p2', sortOrder: 1, updatedAt: 1000, blockId: 'b1', key: 'b', value: 'v2', type: 'string' as const, isHidden: false, isDeleted: false, schemaVersion: 1, createdAt: 0 }
      ]
      ;(storage.getProperties as any).mockResolvedValueOnce(properties)
      ;(storage.saveProperty as any).mockResolvedValue(undefined)

      await service.updateSortOrder('b1', ['p2', 'p1'])

      expect(storage.saveProperty).toHaveBeenCalledTimes(2)

      const p1Call = (storage.saveProperty as any).mock.calls.find((c: any[]) => c[0].id === 'p1')
      expect(p1Call[0].sortOrder).toBe(1)

      const p2Call = (storage.saveProperty as any).mock.calls.find((c: any[]) => c[0].id === 'p2')
      expect(p2Call[0].sortOrder).toBe(0)
    })
  })

  describe('toggleHidden', () => {
    it('toggles isHidden from false to true', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getPropertyById as any).mockResolvedValueOnce({
        id: 'p1',
        blockId: 'b1',
        key: 'status',
        value: 'todo',
        type: 'string' as const,
        sortOrder: 0,
        isHidden: false,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 1000
      })
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      const result = await service.toggleHidden('p1')

      expect(result.isHidden).toBe(true)
    })

    it('toggles isHidden from true to false', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getPropertyById as any).mockResolvedValueOnce({
        id: 'p1',
        blockId: 'b1',
        key: 'status',
        value: 'todo',
        type: 'string' as const,
        sortOrder: 0,
        isHidden: true,
        isDeleted: false,
        schemaVersion: 1,
        createdAt: 0,
        updatedAt: 1000
      })
      ;(storage.saveProperty as any).mockResolvedValueOnce(undefined)

      const result = await service.toggleHidden('p1')

      expect(result.isHidden).toBe(false)
    })

    it('throws error when property not found', async () => {
      const { storage } = await import('../storage/indexedDB')
      ;(storage.getPropertyById as any).mockResolvedValueOnce(undefined)

      await expect(service.toggleHidden('non-existent')).rejects.toThrow('Property not found')
    })
  })

  describe('getPropertyDefinition', () => {
    it('returns property definition', async () => {
      const { getPropertyDefinition } = await import('../types/property')
      ;(getPropertyDefinition as any).mockReturnValueOnce({ key: 'status', type: 'select' })

      const result = service.getPropertyDefinition('status')
      expect(result).toEqual({ key: 'status', type: 'select' })
    })
  })

  describe('getAllPropertyDefinitions', () => {
    it('returns all property definitions', async () => {
      const definitions = [
        { key: 'status', type: 'select' },
        { key: 'priority', type: 'select' }
      ]

      const { getAllPropertyDefinitions } = await import('../types/property')
      ;(getAllPropertyDefinitions as any).mockReturnValueOnce(definitions)

      const result = service.getAllPropertyDefinitions()
      expect(result).toEqual(definitions)
    })
  })
})
