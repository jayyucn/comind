import { describe, it, expect } from 'vitest'
import {
  PREDEFINED_RELATIONSHIPS,
  getPredefinedRelationship,
  getInverseRelationshipType,
  getRelationshipColor,
  type PredefinedRelationship
} from './relationship'

describe('relationship', () => {
  describe('PREDEFINED_RELATIONSHIPS', () => {
    it('应包含所有预定义关系类型', () => {
      expect(PREDEFINED_RELATIONSHIPS).toHaveLength(10)
    })

    it('每个关系都应有完整的属性', () => {
      for (const rel of PREDEFINED_RELATIONSHIPS) {
        expect(rel.type).toBeTruthy()
        expect(rel.label).toBeTruthy()
        expect(rel.inverseLabel).toBeTruthy()
        expect(rel.color).toBeTruthy()
      }
    })

    it('反向关系配对应一致', () => {
      // 检查 parent <-> child 配对
      const parent = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'parent')
      const child = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'child')
      expect(parent?.inverse).toBe('child')
      expect(child?.inverse).toBe('parent')

      // 检查 depends-on <-> required-by 配对
      const dependsOn = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'depends-on')
      const requiredBy = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'required-by')
      expect(dependsOn?.inverse).toBe('required-by')
      expect(requiredBy?.inverse).toBe('depends-on')

      // 检查 references <-> referenced-by 配对
      const references = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'references')
      const referencedBy = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'referenced-by')
      expect(references?.inverse).toBe('referenced-by')
      expect(referencedBy?.inverse).toBe('references')

      // 检查 example-of <-> has-example 配对
      const exampleOf = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'example-of')
      const hasExample = PREDEFINED_RELATIONSHIPS.find(r => r.type === 'has-example')
      expect(exampleOf?.inverse).toBe('has-example')
      expect(hasExample?.inverse).toBe('example-of')
    })
  })

  describe('getPredefinedRelationship', () => {
    it('应通过类型获取预定义关系', () => {
      const result = getPredefinedRelationship('parent')
      expect(result).toEqual<Pick<PredefinedRelationship, 'type' | 'inverse' | 'label' | 'inverseLabel' | 'color'>>({
        type: 'parent',
        inverse: 'child',
        label: '父级',
        inverseLabel: '子级',
        color: '#1890ff'
      })
    })

    it('对不存在的类型应返回 undefined', () => {
      expect(getPredefinedRelationship('non-existent-type')).toBeUndefined()
    })

    it('应正确获取所有预定义关系类型', () => {
      const types = ['parent', 'child', 'depends-on', 'required-by', 'references', 'referenced-by', 'example-of', 'has-example', 'related', 'similar']
      for (const type of types) {
        const result = getPredefinedRelationship(type)
        expect(result).toBeTruthy()
        expect(result?.type).toBe(type)
      }
    })
  })

  describe('getInverseRelationshipType', () => {
    it('应返回预定义关系的反向类型', () => {
      expect(getInverseRelationshipType('parent')).toBe('child')
      expect(getInverseRelationshipType('child')).toBe('parent')
      expect(getInverseRelationshipType('depends-on')).toBe('required-by')
      expect(getInverseRelationshipType('required-by')).toBe('depends-on')
      expect(getInverseRelationshipType('references')).toBe('referenced-by')
      expect(getInverseRelationshipType('referenced-by')).toBe('references')
      expect(getInverseRelationshipType('example-of')).toBe('has-example')
      expect(getInverseRelationshipType('has-example')).toBe('example-of')
    })

    it('对自反关系应返回自身', () => {
      expect(getInverseRelationshipType('related')).toBe('related')
      expect(getInverseRelationshipType('similar')).toBe('similar')
    })

    it('对不存在的关系类型应返回 null', () => {
      expect(getInverseRelationshipType('non-existent-type')).toBeNull()
    })
  })

  describe('getRelationshipColor', () => {
    it('应返回预定义关系的颜色', () => {
      expect(getRelationshipColor('parent')).toBe('#1890ff')
      expect(getRelationshipColor('child')).toBe('#1890ff')
      expect(getRelationshipColor('depends-on')).toBe('#faad14')
      expect(getRelationshipColor('required-by')).toBe('#faad14')
      expect(getRelationshipColor('references')).toBe('#52c41a')
      expect(getRelationshipColor('referenced-by')).toBe('#52c41a')
      expect(getRelationshipColor('example-of')).toBe('#eb2f96')
      expect(getRelationshipColor('has-example')).toBe('#eb2f96')
      expect(getRelationshipColor('related')).toBe('#8c8c8c')
      expect(getRelationshipColor('similar')).toBe('#722ed1')
    })

    it('对不存在的关系类型应返回默认灰色', () => {
      expect(getRelationshipColor('non-existent-type')).toBe('#8c8c8c')
    })

    it('对空字符串应返回默认灰色', () => {
      expect(getRelationshipColor('')).toBe('#8c8c8c')
    })
  })
})
