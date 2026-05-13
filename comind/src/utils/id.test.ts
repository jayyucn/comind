import { describe, it, expect } from 'vitest'
import { generateUUID } from './id'

describe('generateUUID', () => {
  it('generates a valid UUID v4 format', () => {
    const uuid = generateUUID()
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(uuid).toMatch(uuidRegex)
  })

  it('generates different UUIDs on each call', () => {
    const uuids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID())
    }
    expect(uuids.size).toBe(100)
  })

  it('has correct format with 5 groups', () => {
    const uuid = generateUUID()
    const parts = uuid.split('-')
    expect(parts.length).toBe(5)
    expect(parts[0].length).toBe(8)
    expect(parts[1].length).toBe(4)
    expect(parts[2].length).toBe(4)
    expect(parts[3].length).toBe(4)
    expect(parts[4].length).toBe(12)
  })

  it('version 4 identifier is present', () => {
    const uuid = generateUUID()
    const parts = uuid.split('-')
    expect(parts[2][0]).toBe('4')
  })

  it('variant bits are correct (8, 9, a, or b)', () => {
    const uuid = generateUUID()
    const parts = uuid.split('-')
    const variant = parts[3][0].toLowerCase()
    expect(['8', '9', 'a', 'b']).toContain(variant)
  })

  it('contains only lowercase hexadecimal characters', () => {
    const uuid = generateUUID()
    const hexRegex = /^[0-9a-f-]+$/
    expect(uuid).toMatch(hexRegex)
  })

  it('is a string', () => {
    const uuid = generateUUID()
    expect(typeof uuid).toBe('string')
  })

  it('is 36 characters long', () => {
    const uuid = generateUUID()
    expect(uuid.length).toBe(36)
  })
})
