import { describe, test, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from './editor'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useEditorStore', () => {
  describe('activeBlockId 状态', () => {
    test('初始 activeBlockId 为 null', () => {
      const store = useEditorStore()
      expect(store.activeBlockId).toBeNull()
    })

    test('activateBlock 设置 activeBlockId', () => {
      const store = useEditorStore()
      store.activateBlock('block-1')
      expect(store.activeBlockId).toBe('block-1')
    })

    test('activateBlock 切换到其他 block', () => {
      const store = useEditorStore()
      store.activateBlock('block-1')
      store.activateBlock('block-2')
      expect(store.activeBlockId).toBe('block-2')
    })

    test('deactivateBlock 清空 activeBlockId', () => {
      const store = useEditorStore()
      store.activateBlock('block-1')
      store.deactivateBlock()
      expect(store.activeBlockId).toBeNull()
    })
  })

  describe('pendingCursorPos 状态', () => {
    test('初始 pendingCursorPos 为 null', () => {
      const store = useEditorStore()
      expect(store.pendingCursorPos).toBeNull()
    })

    test('activateBlock 设置光标位置', () => {
      const store = useEditorStore()
      store.activateBlock('block-1', 50)
      expect(store.pendingCursorPos).toBe(50)
    })

    test('consumeCursorPos 获取并清空光标位置', () => {
      const store = useEditorStore()
      store.setCursorPos(100)
      expect(store.consumeCursorPos()).toBe(100)
      expect(store.pendingCursorPos).toBeNull()
    })

    test('setCursorPos 直接设置光标位置', () => {
      const store = useEditorStore()
      store.setCursorPos(200)
      expect(store.pendingCursorPos).toBe(200)
    })

    test('consumeCursorPos 多次调用返回 null', () => {
      const store = useEditorStore()
      store.setCursorPos(300)
      store.consumeCursorPos()
      expect(store.consumeCursorPos()).toBeNull()
    })
  })

  describe('activeEditor 状态', () => {
    test('初始 activeEditor 为 null', () => {
      const store = useEditorStore()
      expect(store.activeEditor).toBeNull()
    })

    test('setActiveEditor 设置编辑器实例', () => {
      const store = useEditorStore()
      const mockEditor = { id: 'test-editor' } as any
      store.setActiveEditor(mockEditor)
      expect(store.activeEditor).toEqual(mockEditor)
    })
  })

  describe('斜杠命令面板', () => {
    test('初始 slashCommand 为 null', () => {
      const store = useEditorStore()
      expect(store.slashCommand).toBeNull()
    })

    test('showSlashCommand 显示斜杠命令面板', () => {
      const store = useEditorStore()
      const position = { x: 100, y: 200 }
      const range = { from: 0, to: 10 }
      store.showSlashCommand(position, range)
      expect(store.slashCommand).toEqual({
        visible: true,
        query: '',
        selectedIndex: 0,
        position,
        range
      })
    })

    test('hideSlashCommand 隐藏斜杠命令面板', () => {
      const store = useEditorStore()
      store.showSlashCommand({ x: 100, y: 200 }, { from: 0, to: 10 })
      store.hideSlashCommand()
      expect(store.slashCommand?.visible).toBe(false)
    })

    test('updateSlashQuery 更新查询字符串', () => {
      const store = useEditorStore()
      store.showSlashCommand({ x: 100, y: 200 }, { from: 0, to: 10 })
      store.updateSlashQuery('todo')
      expect(store.slashCommand?.query).toBe('todo')
      expect(store.slashCommand?.selectedIndex).toBe(0)
    })

    test('updateSlashSelectedIndex 更新选中索引', () => {
      const store = useEditorStore()
      store.showSlashCommand({ x: 100, y: 200 }, { from: 0, to: 10 })
      store.updateSlashSelectedIndex(2)
      expect(store.slashCommand?.selectedIndex).toBe(2)
    })
  })

  describe('属性编辑器', () => {
    test('初始 propertyEditor 为 null', () => {
      const store = useEditorStore()
      expect(store.propertyEditor).toBeNull()
    })

    test('showPropertyEditor 显示属性编辑器', () => {
      const store = useEditorStore()
      store.showPropertyEditor('block-1', 'priority')
      expect(store.propertyEditor).toEqual({
        visible: true,
        blockId: 'block-1',
        initialKey: 'priority'
      })
    })

    test('showPropertyEditor 无初始 key', () => {
      const store = useEditorStore()
      store.showPropertyEditor('block-1')
      expect(store.propertyEditor).toEqual({
        visible: true,
        blockId: 'block-1',
        initialKey: null
      })
    })

    test('hidePropertyEditor 隐藏属性编辑器', () => {
      const store = useEditorStore()
      store.showPropertyEditor('block-1')
      store.hidePropertyEditor()
      expect(store.propertyEditor?.visible).toBe(false)
    })
  })

  describe('快捷属性编辑器', () => {
    test('初始 quickPropertyEditor 为 null', () => {
      const store = useEditorStore()
      expect(store.quickPropertyEditor).toBeNull()
    })

    test('showQuickPropertyEditor 显示快捷属性编辑器', () => {
      const store = useEditorStore()
      const position = { x: 150, y: 250 }
      store.showQuickPropertyEditor('block-1', 'tags', position)
      expect(store.quickPropertyEditor).toEqual({
        visible: true,
        blockId: 'block-1',
        key: 'tags',
        position
      })
    })

    test('showQuickPropertyEditor 无位置参数', () => {
      const store = useEditorStore()
      store.showQuickPropertyEditor('block-1', 'status')
      expect(store.quickPropertyEditor).toEqual({
        visible: true,
        blockId: 'block-1',
        key: 'status',
        position: null
      })
    })

    test('hideQuickPropertyEditor 隐藏快捷属性编辑器', () => {
      const store = useEditorStore()
      store.showQuickPropertyEditor('block-1', 'tags')
      store.hideQuickPropertyEditor()
      expect(store.quickPropertyEditor?.visible).toBe(false)
    })
  })
})
