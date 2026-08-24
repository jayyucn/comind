import { describe, it, expect, beforeEach } from 'vitest'
import { useBlockRegistry } from './useBlockRegistry'
import type { BlockTypeHandler } from '../types/block-type'
import { defineComponent, h } from 'vue'

const createMockHandler = (type: string, label: string): BlockTypeHandler => ({
  type,
  label,
  editorComponent: defineComponent({ render: () => h('div') }),
  renderComponent: defineComponent({ render: () => h('div') })
})

describe('useBlockRegistry', () => {
  let registry: ReturnType<typeof useBlockRegistry>

  beforeEach(() => {
    registry = useBlockRegistry()
  })

  describe('register', () => {
    it('registers a new handler type', () => {
      const handler = createMockHandler('test-register', 'Test')
      registry.register(handler)

      expect(registry.getRegisteredTypes()).toContain('test-register')
    })

    it('registers multiple handler types', () => {
      registry.register(createMockHandler('type1-register', 'Type 1'))
      registry.register(createMockHandler('type2-register', 'Type 2'))
      registry.register(createMockHandler('type3-register', 'Type 3'))

      const types = registry.getRegisteredTypes()
      expect(types).toContain('type1-register')
      expect(types).toContain('type2-register')
      expect(types).toContain('type3-register')
    })

    it('prevents duplicate registration of same type', () => {
      registry.register(createMockHandler('duplicate-register', 'First'))
      registry.register(createMockHandler('duplicate-register', 'Second'))

      const types = registry.getRegisteredTypes()
      const count = types.filter(t => t === 'duplicate-register').length
      expect(count).toBe(1)
    })

    it('stores correct handler data', () => {
      const handler = createMockHandler('stored-register', 'Stored Handler')
      registry.register(handler)

      const retrieved = registry.getHandler('stored-register')
      expect(retrieved).toBeDefined()
      expect(retrieved?.type).toBe('stored-register')
      expect(retrieved?.label).toBe('Stored Handler')
    })
  })

  describe('getHandler', () => {
    it('retrieves registered handler by type', () => {
      registry.register(createMockHandler('bullet-get', 'Bullet'))
      registry.register(createMockHandler('code-get', 'Code'))

      const bulletHandler = registry.getHandler('bullet-get')
      expect(bulletHandler?.type).toBe('bullet-get')
      expect(bulletHandler?.label).toBe('Bullet')
    })

    it('returns undefined for unregistered type', () => {
      const handler = registry.getHandler('non-existent-type')
      expect(handler).toBeUndefined()
    })

    it('returns handler multiple times for same type', () => {
      registry.register(createMockHandler('existing-get', 'Existing'))

      const first = registry.getHandler('existing-get')
      const second = registry.getHandler('existing-get')
      expect(first).toBeDefined()
      expect(second).toBeDefined()
    })
  })

  describe('getRegisteredTypes', () => {
    it('returns array containing all registered types', () => {
      const types = registry.getRegisteredTypes()
      expect(Array.isArray(types)).toBe(true)
    })

    it('includes types registered in previous tests', () => {
      const types = registry.getRegisteredTypes()
      expect(types.length).toBeGreaterThan(0)
    })
  })

  describe('integration scenarios', () => {
    it('handles realistic block type registration', () => {
      registry.register(createMockHandler('bullet-real', 'Bullet List'))
      registry.register(createMockHandler('code-real', 'Code Block'))
      registry.register(createMockHandler('image-real', 'Image'))
      registry.register(createMockHandler('embed-real', 'Embed'))

      expect(registry.getRegisteredTypes()).toContain('bullet-real')
      expect(registry.getRegisteredTypes()).toContain('code-real')
      expect(registry.getRegisteredTypes()).toContain('image-real')
      expect(registry.getRegisteredTypes()).toContain('embed-real')

      expect(registry.getHandler('bullet-real')?.label).toBe('Bullet List')
      expect(registry.getHandler('code-real')?.label).toBe('Code Block')
      expect(registry.getHandler('image-real')?.label).toBe('Image')
      expect(registry.getHandler('embed-real')?.label).toBe('Embed')
    })

    it('handles edge cases with special characters in type names', () => {
      registry.register(createMockHandler('type-dash', 'Dash Type'))
      registry.register(createMockHandler('type_underscore', 'Underscore Type'))
      registry.register(createMockHandler('type.dots', 'Dots Type'))

      expect(registry.getHandler('type-dash')?.label).toBe('Dash Type')
      expect(registry.getHandler('type_underscore')?.label).toBe('Underscore Type')
      expect(registry.getHandler('type.dots')?.label).toBe('Dots Type')
    })
  })
})
