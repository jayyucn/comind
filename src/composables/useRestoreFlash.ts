import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * 撤销/重做落点的墨迹测量 + 闪烁状态机（#109 裁定的实现，#115 自 BlockList 抽出）。
 *
 * 为什么是「量出来的矩形」而不是给块加类、用 `::after` 铺遮罩（2026-09-15 裁定）：
 * 遮罩铺的是**宿主盒**，而内容区宿主恒是满宽 —— 真机实测 720px 的行里文字只有 19px，
 * 铺出来就是一大片压在空白上的色块。这里换用与文本选区同一套手法（`Range`）量**墨迹**：
 * 内容区与属性区各自的**实际内容范围**，于是只有「有内容的非空白区域」会亮。
 * 附带好处：矩形独立于块选区与编辑态 —— `focusActiveEditor` 的 `clearSelection()` 抹不掉它。
 */

/** 闪烁窗口（ms）：模板里 `.restore-flash-rect` 的淡出时长由本常量经 inline style 下发（单源，#115） */
export const UNDO_FLASH_MS = 600

/** 原子内容元素（图片/画布/音视频/内嵌页）：它们的**自身盒**就是墨迹，不必也不该往里钻 */
const ATOMIC_INK_SELECTOR = 'img, canvas, video, audio, iframe, object, embed, svg'

/**
 * 收集一个区域内的**墨迹**矩形：文本按 `Range` 逐行贴字，原子元素取自身盒。
 * 块级容器（`.block-text`、`.cm-line`、属性 chip 的外壳…）**自己不取** —— 它的盒是满宽，
 * 取它就等于把色块铺回空白上（真机实测：`.block-content` 的 Range bbox 是 **700×24** 满宽，
 * 而文字只有 19×24）。这就是「只亮非空白区域」的全部技术含义。
 */
function collectInkRects(node: Node, out: DOMRect[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!child.textContent?.trim()) return
      const range = document.createRange()
      range.selectNode(child)
      out.push(...range.getClientRects())
      return
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return
    const el = child as Element
    if (el.matches(ATOMIC_INK_SELECTOR)) {
      out.push(el.getBoundingClientRect())
      return
    }
    collectInkRects(el, out)
  })
}

/** 区域内**墨迹**的包围盒；区域内空无一物（空块的内容区、无属性块的属性带）返回 null */
function regionInkRect(host: Element | null): DOMRect | null {
  if (!host) return null
  const ink: DOMRect[] = []
  collectInkRects(host, ink)
  const solid = ink.filter((r) => r.width > 0 && r.height > 0)
  if (solid.length === 0) return null
  const left = Math.min(...solid.map((r) => r.left))
  const top = Math.min(...solid.map((r) => r.top))
  const right = Math.max(...solid.map((r) => r.right))
  const bottom = Math.max(...solid.map((r) => r.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

/**
 * 量出这些块「内容区 + 属性区」的墨迹矩形（顺序同传参）。
 * 对外唯一测量入口 —— 单测经它构造真实块 DOM 覆盖全部分支，内部函数不外泄。
 */
export function measureBlockInkRects(root: HTMLElement | null, ids: string[]): DOMRect[] {
  if (!root) return []
  const rects: DOMRect[] = []
  for (const id of ids) {
    // 限定在本实例的渲染树内查：多实例共存时避免量到弹窗/抽屉里的副本
    const blockEl = root.querySelector(`[data-block-id="${id}"]`)
    if (!blockEl) continue
    // 内容区在 .block-row 下还有 .block-inner/.block-body 两层，故用后代选择器；子块的内容区在
    // `.block-children`（.block-row 的**兄弟**）之下，不会被这里捞到。
    const hosts = blockEl.querySelectorAll(':scope > .block-row .block-content, :scope > .block-properties')
    hosts.forEach((host) => {
      const rect = regionInkRect(host)
      if (rect) rects.push(rect)
    })
  }
  return rects
}

export interface RestoreFlash {
  /** 闪烁中的矩形（视口坐标，交给 Teleport 到 body 的 fixed 层绘制） */
  flashRects: Ref<DOMRect[]>
  /** 闪烁窗口内仍有效的块 id：视口变化（滚动 / 缩放）时据此重算 —— fixed 矩形会随滚动失效 */
  flashingIds: Ref<string[]>
  flashChangedBlocks: (ids: string[]) => void
  refreshFlashRects: () => void
}

/**
 * 闪烁状态机：整批替换写入 + `UNDO_FLASH_MS` 窗口到期清空 + 视口变化重算。
 * 须在组件 setup 上下文调用 —— timer 清理挂 `onScopeDispose`，随组件卸载自动执行。
 */
export function useRestoreFlash(getRoot: () => HTMLElement | null): RestoreFlash {
  const flashRects = ref<DOMRect[]>([])
  const flashingIds = ref<string[]>([])
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  function flashChangedBlocks(ids: string[]): void {
    // 整体替换（而非逐个增删）：让上一轮的块在本轮即刻失去闪烁，不残留旧矩形
    flashRects.value = measureBlockInkRects(getRoot(), ids)
    flashingIds.value = ids
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashRects.value = []
      flashingIds.value = []
      flashTimer = null
    }, UNDO_FLASH_MS)
  }

  /** 重算闪烁矩形（随视口变化重画）；不在闪烁窗口内时为空操作 */
  function refreshFlashRects(): void {
    if (flashingIds.value.length === 0) return
    flashRects.value = measureBlockInkRects(getRoot(), flashingIds.value)
  }

  // 不清理会让已卸载实例的 ref 在闪烁窗口结束后被写（无害但无谓）
  onScopeDispose(() => {
    if (flashTimer) clearTimeout(flashTimer)
  })

  return { flashRects, flashingIds, flashChangedBlocks, refreshFlashRects }
}
