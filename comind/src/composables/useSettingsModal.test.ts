import { describe, test, expect, beforeEach } from 'vitest'
import { useSettingsModal } from './useSettingsModal'

describe('useSettingsModal', () => {
  beforeEach(() => {
    const { close } = useSettingsModal()
    close()
  })

  describe('初始状态', () => {
    test('初始状态为关闭', () => {
      const { isOpen } = useSettingsModal()
      expect(isOpen.value).toBe(false)
    })
  })

  describe('open 方法', () => {
    test('open 方法将状态设置为打开', () => {
      const { isOpen, open } = useSettingsModal()
      
      expect(isOpen.value).toBe(false)
      
      open()
      
      expect(isOpen.value).toBe(true)
    })

    test('多次调用 open 保持打开状态', () => {
      const { isOpen, open } = useSettingsModal()
      
      open()
      open()
      open()
      
      expect(isOpen.value).toBe(true)
    })
  })

  describe('close 方法', () => {
    test('close 方法将状态设置为关闭', () => {
      const { isOpen, open, close } = useSettingsModal()
      
      open()
      expect(isOpen.value).toBe(true)
      
      close()
      
      expect(isOpen.value).toBe(false)
    })

    test('多次调用 close 保持关闭状态', () => {
      const { isOpen, open, close } = useSettingsModal()
      
      open()
      close()
      close()
      close()
      
      expect(isOpen.value).toBe(false)
    })
  })

  describe('多个调用者共享同一状态', () => {
    test('多个 useSettingsModal 调用者看到相同的状态', () => {
      const { isOpen: isOpen1, open: open1 } = useSettingsModal()
      const { isOpen: isOpen2, close: close2 } = useSettingsModal()
      
      expect(isOpen1.value).toBe(false)
      expect(isOpen2.value).toBe(false)
      
      open1()
      
      expect(isOpen1.value).toBe(true)
      expect(isOpen2.value).toBe(true)
      
      close2()
      
      expect(isOpen1.value).toBe(false)
      expect(isOpen2.value).toBe(false)
    })
  })
})
