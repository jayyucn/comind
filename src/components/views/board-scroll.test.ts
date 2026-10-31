import { describe, expect, it } from 'vitest'

import {
  canConsumeVertical,
  countHiddenRight,
  edgeAutoScrollSpeed,
  isPanStartAllowed,
  pageStepOf,
} from './board-scroll'

describe('board-scroll 纯计算件', () => {
  describe('edgeAutoScrollSpeed', () => {
    it('指针在中央时不动', () => {
      expect(edgeAutoScrollSpeed(300, 0, 600)).toBe(0)
    })

    it('进入右边缘带后按比例加速，且始终向右（正号）', () => {
      const near = edgeAutoScrollSpeed(560, 0, 600)
      const far = edgeAutoScrollSpeed(600, 0, 600)
      expect(near).toBeGreaterThan(0)
      expect(far).toBeGreaterThan(near)
    })

    it('越过容器边界按满速处理（用户意图明确）', () => {
      expect(edgeAutoScrollSpeed(900, 0, 600)).toBe(16)
      expect(edgeAutoScrollSpeed(-200, 0, 600)).toBe(-16)
    })

    it('左侧对称', () => {
      expect(edgeAutoScrollSpeed(40, 0, 600)).toBeLessThan(0)
      expect(edgeAutoScrollSpeed(0, 0, 600)).toBe(-16)
    })

    it('触边带宽度为 0 时永不滚动（禁用开关）', () => {
      expect(edgeAutoScrollSpeed(1, 0, 600, 0)).toBe(0)
    })
  })

  describe('canConsumeVertical', () => {
    const el = (scrollTop: number, scrollHeight = 500, clientHeight = 200) => ({
      scrollTop,
      scrollHeight,
      clientHeight,
    })

    it('还有向下余量 → 可以消费', () => {
      expect(canConsumeVertical(el(0), 100)).toBe(true)
    })

    it('已到底 → 不再消费（滚轮应交棒给看板横滚）', () => {
      expect(canConsumeVertical(el(300), 100)).toBe(false)
    })

    it('已到顶且方向向上 → 不再消费', () => {
      expect(canConsumeVertical(el(0), -100)).toBe(false)
    })

    it('没有纵向溢出 → 不消费', () => {
      expect(canConsumeVertical(el(0, 200, 200), 100)).toBe(false)
    })

    it('deltaY 为 0 → 不消费', () => {
      expect(canConsumeVertical(el(0), 0)).toBe(false)
    })
  })

  describe('countHiddenRight', () => {
    it('只数「完全越过右边界」的列，半截露出的不算', () => {
      const cols = [{ left: 12 }, { left: 280 }, { left: 548 }, { left: 816 }]
      // 半截露出的 548 不算：用户看得见它，也拖得进去
      expect(countHiddenRight(cols, 600)).toBe(1)
    })

    it('全部可见时为 0', () => {
      expect(countHiddenRight([{ left: 12 }, { left: 200 }], 600)).toBe(0)
    })

    it('没有列时为 0', () => {
      expect(countHiddenRight([], 600)).toBe(0)
    })
  })

  describe('pageStepOf', () => {
    it('一屏减一列，留一列作锚', () => {
      expect(pageStepOf(1000, 268)).toBe(732)
    })

    it('视口比两列还窄时至少滚一列', () => {
      expect(pageStepOf(300, 268)).toBe(268)
    })
  })

  describe('isPanStartAllowed（空白区拖拽平移的起手边界）', () => {
    /** 造一个带祖先链的元素：<div class=board-view><div class=X>target</div></div> */
    function inside(...classes: string[]): Element {
      const root = document.createElement('div')
      root.className = 'board-view'
      let node: HTMLElement = root
      for (const cls of classes) {
        const child = document.createElement('div')
        child.className = cls
        node.appendChild(child)
        node = child
      }
      return node
    }

    const ok = { button: 0, pointerType: 'mouse', maxScroll: 400 }

    it('列内空白 / 列间间隙 / 列下方背景 → 允许', () => {
      expect(isPanStartAllowed(inside('board-column', 'column-cards'), ok)).toBe(true)
      expect(isPanStartAllowed(inside('board-column'), ok)).toBe(true)
      expect(isPanStartAllowed(inside(), ok)).toBe(true)
    })

    it('卡片上不允许（左键拖卡片是改分组，同一手势不能两种语义）', () => {
      expect(isPanStartAllowed(inside('board-column', 'column-cards', 'board-card'), ok)).toBe(false)
    })

    it('列头上不允许（留给将来的列排序）', () => {
      expect(isPanStartAllowed(inside('board-column', 'column-header'), ok)).toBe(false)
    })

    it('不可滚时不允许（没有可移动的内容）', () => {
      expect(isPanStartAllowed(inside(), { ...ok, maxScroll: 0 })).toBe(false)
    })

    it('只左键：中键与右键不接管', () => {
      expect(isPanStartAllowed(inside(), { ...ok, button: 1 })).toBe(false)
      expect(isPanStartAllowed(inside(), { ...ok, button: 2 })).toBe(false)
    })

    it('触摸与触屏笔不接管（那里原生横滑本来就能滚）', () => {
      expect(isPanStartAllowed(inside(), { ...ok, pointerType: 'touch' })).toBe(false)
      expect(isPanStartAllowed(inside(), { ...ok, pointerType: 'pen' })).toBe(false)
    })

    it('空目标不炸，也不接管', () => {
      expect(isPanStartAllowed(null, ok)).toBe(false)
    })
  })
})
