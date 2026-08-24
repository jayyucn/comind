import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { pushModal, popModal, hasModalOpen, getModalStack } from './useModalKeyboard'

function clearModalStack() {
  const stack = getModalStack()
  for (const modal of stack) {
    popModal(modal)
  }
}

beforeEach(() => {
  clearModalStack()
})

afterEach(() => {
  clearModalStack()
})

describe('useModalKeyboard', () => {
  describe('pushModal', () => {
    test('push 模态层到栈', () => {
      expect(hasModalOpen()).toBe(false)
      
      pushModal('modal1')
      
      expect(hasModalOpen()).toBe(true)
      expect(getModalStack()).toEqual(['modal1'])
    })

    test('push 相同模态层不重复', () => {
      pushModal('modal1')
      pushModal('modal1')
      
      expect(getModalStack()).toEqual(['modal1'])
    })

    test('push 多个不同模态层', () => {
      pushModal('modal1')
      pushModal('modal2')
      pushModal('modal3')
      
      expect(getModalStack()).toContain('modal1')
      expect(getModalStack()).toContain('modal2')
      expect(getModalStack()).toContain('modal3')
    })
  })

  describe('popModal', () => {
    test('pop 存在的模态层', () => {
      pushModal('modal1')
      pushModal('modal2')
      
      const stackBefore = getModalStack()
      expect(stackBefore).toContain('modal1')
      expect(stackBefore).toContain('modal2')
      
      popModal('modal2')
      
      const stackAfter = getModalStack()
      expect(stackAfter).toContain('modal1')
      expect(stackAfter).not.toContain('modal2')
    })

    test('pop 不存在的模态层无操作', () => {
      pushModal('modal1')
      
      const stackBefore = getModalStack()
      
      popModal('non-existent')
      
      expect(getModalStack()).toEqual(stackBefore)
    })

    test('pop 所有模态层后 hasModalOpen 返回 false', () => {
      pushModal('modal1')
      pushModal('modal2')
      
      popModal('modal1')
      popModal('modal2')
      
      expect(hasModalOpen()).toBe(false)
      expect(getModalStack()).toEqual([])
    })
  })

  describe('hasModalOpen', () => {
    test('栈为空时返回 false', () => {
      expect(hasModalOpen()).toBe(false)
    })

    test('栈有元素时返回 true', () => {
      pushModal('modal1')
      
      expect(hasModalOpen()).toBe(true)
    })

    test('所有元素被移除后返回 false', () => {
      pushModal('modal1')
      popModal('modal1')
      
      expect(hasModalOpen()).toBe(false)
    })
  })

  describe('getModalStack', () => {
    test('返回栈的副本', () => {
      pushModal('modal1')
      pushModal('modal2')
      
      const stack = getModalStack()
      stack.push('fake')
      
      expect(getModalStack()).not.toContain('fake')
    })

    test('空栈返回空数组', () => {
      expect(getModalStack()).toEqual([])
    })
  })
})