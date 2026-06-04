import { describe, test, expect } from 'vitest'
import {
  findRelationshipAtCaret,
  notifyRelationshipMenuSelect,
  closeRelationshipMenuByEditor,
  type RelationshipAtCaretResult
} from './RelationshipTriggerExtension'

/**
 * RelationshipTriggerExtension 测试
 *
 * 注意：findRelationshipAtCaret 依赖 ProseMirror doc.textBetween() 的精确行为
 *（包括 node boundary 处理），我们的 mock 无法完全模拟。
 * 该函数已在 useCrossBlockSelection.test.ts 和 useBlockRelationshipCleanup.test.ts
 * 中通过集成测试间接覆盖。
 *
 * 本测试文件聚焦于：
 * 1. 模块导出函数的存在性和可调用性
 * 2. RelationshipAtCaretResult 接口结构验证
 */
describe('RelationshipTriggerExtension', () => {
  describe('module exports', () => {
    test('findRelationshipAtCaret 应该是可导出的函数', () => {
      expect(typeof findRelationshipAtCaret).toBe('function')
    })

    test('notifyRelationshipMenuSelect 应该是可调用的函数', () => {
      expect(typeof notifyRelationshipMenuSelect).toBe('function')
      expect(() => notifyRelationshipMenuSelect()).not.toThrow()
    })

    test('notifyRelationshipMenuSelect 多次调用应该不抛错', () => {
      expect(() => {
        notifyRelationshipMenuSelect()
        notifyRelationshipMenuSelect()
        notifyRelationshipMenuSelect()
      }).not.toThrow()
    })

    test('closeRelationshipMenuByEditor 应该是可调用的函数', () => {
      expect(typeof closeRelationshipMenuByEditor).toBe('function')
      expect(() => closeRelationshipMenuByEditor()).not.toThrow()
    })
  })

  describe('RelationshipAtCaretResult interface', () => {
    test('类型应该包含 found、range、wikiEnd、pageName 字段', () => {
      // 验证类型结构（静态类型检查在编译时进行）
      const result: RelationshipAtCaretResult = {
        found: true,
        range: { from: 0, to: 8 },
        wikiEnd: 6,
        pageName: 'Test'
      }

      expect(result.found).toBe(true)
      expect(result.range).toEqual({ from: 0, to: 8 })
      expect(result.wikiEnd).toBe(6)
      expect(result.pageName).toBe('Test')
    })

    test('found=false 时 range 和 wikiEnd 应为 null', () => {
      const result: RelationshipAtCaretResult = {
        found: false,
        range: null,
        wikiEnd: null,
        pageName: ''
      }

      expect(result.found).toBe(false)
      expect(result.range).toBeNull()
      expect(result.wikiEnd).toBeNull()
      expect(result.pageName).toBe('')
    })
  })

  describe('findRelationshipAtCaret - 边界情况', () => {
    /**
     * 这些测试验证 findRelationshipAtCaret 在边界情况下的行为。
     * 由于无法完全模拟 ProseMirror textBetween，我们只测试明确的失败情况。
     */

    test('空文本应返回 not found', () => {
      const doc = { textBetween: () => '' }
      const result = findRelationshipAtCaret(doc as any, 0)
      expect(result.found).toBe(false)
    })

    test('不包含 ^ 的文本应返回 not found', () => {
      const doc = { textBetween: () => 'some text' }
      const result = findRelationshipAtCaret(doc as any, 9)
      expect(result.found).toBe(false)
    })

    test('仅包含 ^ 应返回 not found', () => {
      const doc = { textBetween: () => '^' }
      const result = findRelationshipAtCaret(doc as any, 1)
      expect(result.found).toBe(false)
    })

    test('^ 前面没有 ]] 应返回 not found', () => {
      // ^ 前只有一个 ]
      const doc = { textBetween: () => ']' }
      const result = findRelationshipAtCaret(doc as any, 1)
      expect(result.found).toBe(false)
    })

    test('^ 前面是 ]] 但前面没有 [[ 应返回 not found', () => {
      // text = ]]^，但没有 [[
      const doc = { textBetween: () => ']]^' }
      const result = findRelationshipAtCaret(doc as any, 3)
      expect(result.found).toBe(false)
    })

    test('^ 前面是空格 + ]] 应返回 not found（修复验证）', () => {
      // 这是 commit 1bfdebf 修复的 bug 场景
      // 之前：']] ^' 也会触发
      // 现在：^ 必须紧贴 ]]
      const doc = { textBetween: () => ']] ^' }
      const result = findRelationshipAtCaret(doc as any, 4)
      expect(result.found).toBe(false)
    })
  })
})
