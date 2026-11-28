import { useEditorStore } from '../stores/editor'
import { usePanesStore } from '../stores/panes'
import { isTauriEnvironment } from '../wasm/tauri-platform'

/**
 * 光标持久化（ADR-0070）：「光标始终聚焦在 block 上」。
 *
 * 三个职责：
 * 1. **记录**：`focusin` 捕获阶段常驻记录「上一次编辑落点」——块 PM 记
 *    `{paneId, blockId}`（偏移信任 PM 内部选区，`focus()` 自还原到原字符位）；
 *    pane 内原生输入框记 `{el, selectionStart/End}`（WeakRef 防泄漏）。
 * 2. **恢复**：三个触发源共用一个入口——用户点击（pointerdown 落点 + pointerup
 *    判定，本机 WebView2 唯一可靠的信号）、窗口焦点事件（DOM focus / Tauri
 *    onFocusChanged / visibilitychange；本机不发，但浏览器、e2e 与其它环境受益）。
 * 3. **让位**：落点在块内 / 可编辑 / 右栏 / 弹层，或 BlockModal 打开中，或抬起时
 *    有选区/位移超阈值，或记录的 pane 不是当前活动 pane，一律不抢。
 */

/** 点击恢复的位移阈值，与 ADR-0069 D4 外链打开、selection-geometry 跨块选区同口径 */
const CLICK_DRAG_THRESHOLD_PX = 4

/** 恢复让位的区域：块内（块有自己的点击语义）、右栏、两类弹层（BasePopover / BlockModal） */
const RESTORE_EXCLUDE_SELECTOR =
  '.block, .right-sidebar, .base-popover-overlay, .block-modal-overlay'

/** 可编辑元素：原生表单控件 + contenteditable（含 PM 根） */
function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return true
  // isContentEditable 只声明在 HTMLElement 上；SVG/MathML 元素没有 contenteditable 语义
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return false
}

/** 文本类输入框（number 等不支持 selectionRange 的类型在记录时再判） */
function isTextInput(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) {
    // 文本族输入框才记光标；number/range 等没有字符偏移语义
    return (
      ['text', 'search', 'url', 'tel', 'password', 'email'].includes(el.type) ||
      el.type === ''
    )
  }
  return false
}

/** focus 目标所属 pane 的 id；不在任何 pane 内（顶栏搜索框等）返回 null */
function paneIdOf(target: Element | null): string | null {
  return target?.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId ?? null
}

export function setupCaretPersistence(): () => void {
  const editorStore = useEditorStore()
  const panesStore = usePanesStore()

  const cleanups: Array<() => void> = []
  let disposed = false

  // ── 记录：focusin 捕获阶段 ──
  function handleFocusIn(e: FocusEvent) {
    const target = e.target
    if (!(target instanceof Element)) return

    if (target.closest('.ProseMirror')) {
      // PM 编辑器聚焦：记块与 pane；字符偏移由 PM 内部选区自带
      const blockId = editorStore.activeBlockId
      if (!blockId) return
      editorStore.setLastEditPoint({
        kind: 'pm',
        paneId: editorStore.activeBlockPaneId,
        blockId,
        editor: editorStore.activeEditor,
      })
      return
    }

    if (isTextInput(target) && typeof target.selectionStart === 'number') {
      const paneId = paneIdOf(target)
      // 只记 pane 内的输入框：顶栏全局搜索等无 pane 语境的输入不该被「恢复」抢回焦点
      if (paneId === null) return
      editorStore.setLastEditPoint({
        kind: 'input',
        paneId,
        el: new WeakRef(target),
        start: target.selectionStart,
        end: target.selectionEnd,
      })
    }
    // 其它（按钮、面板标题等）聚焦不动记录：用户随后回正文时仍能恢复
  }
  document.addEventListener('focusin', handleFocusIn, true)
  cleanups.push(() => document.removeEventListener('focusin', handleFocusIn, true))

  // ── 恢复 ──

  /**
   * 恢复入口。带 `requireLostFocus`：窗口焦点类事件要求焦点真的丢了
   * （activeElement 退到 body）才补——「焦点丢了才补」，不抢仍持有焦点的输入框；
   * 点击路径（pointerup）调用时不传：点击空白本身就会把 activeElement 洗成 body。
   */
  function tryRestore(opts: { requireLostFocus?: boolean } = {}) {
    if (disposed) return
    if (editorStore.blockModalBlockId) return
    if (!editorStore.lastEditPoint) return

    const ae = document.activeElement
    if (ae && ae !== document.body) {
      // 焦点仍在某个具体元素上：只有落在他处可编辑才算「被占用」，按钮等不阻塞
      if (isEditable(ae)) return
      if (opts.requireLostFocus) return
    }

    const point = editorStore.lastEditPoint
    if (point.paneId === null || point.paneId !== panesStore.activePaneId) return

    if (point.kind === 'pm') {
      // 记录的块必须是当前活动块：块已退出激活/被删/换块时记录自然失效
      if (editorStore.activeBlockId !== point.blockId) return
      const editor = editorStore.activeEditor
      if (!editor) return
      // 等一帧：焦点事件先于窗口真正激活到达时，此刻抢焦点可能被忽略
      requestAnimationFrame(() => {
        if (editorStore.activeEditor !== editor) return
        try {
          editor.commands.focus()
        } catch (err) {
          console.error('[caret-persistence] 恢复块光标失败:', err)
        }
      })
      return
    }

    // input：元素还活着才回焦并回设选区
    const el = point.el.deref()
    if (!el || !document.contains(el)) return
    el.focus()
    try {
      if (point.start !== null && point.end !== null && typeof el.selectionStart === 'number') {
        el.setSelectionRange(point.start, point.end)
      }
    } catch {
      // 个别 input 类型不支持 selectionRange，聚焦即可
    }
  }

  // ── 点击恢复：pointerdown 记落点，pointerup 判定（≤4px 且落点在可恢复区）──
  let downX = 0
  let downY = 0
  let downInRestorableZone = false

  function handlePointerdown(e: PointerEvent) {
    if (e.button !== 0) return
    downX = e.clientX
    downY = e.clientY
    const target = e.target
    downInRestorableZone =
      target instanceof Element &&
      !isEditable(target) &&
      !target.closest(RESTORE_EXCLUDE_SELECTOR)
  }

  function handlePointerup(e: PointerEvent) {
    if (e.button !== 0 || !downInRestorableZone) return
    downInRestorableZone = false
    if (Math.abs(e.clientX - downX) > CLICK_DRAG_THRESHOLD_PX) return
    if (Math.abs(e.clientY - downY) > CLICK_DRAG_THRESHOLD_PX) return
    // 抬起时有选区（拖选/双击选词）：选字优先，不恢复
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    tryRestore()
  }
  document.addEventListener('pointerdown', handlePointerdown, true)
  document.addEventListener('pointerup', handlePointerup, true)
  cleanups.push(() => {
    document.removeEventListener('pointerdown', handlePointerdown, true)
    document.removeEventListener('pointerup', handlePointerup, true)
  })

  // ── 窗口焦点类触发（本机 WebView2 不发，但浏览器 / e2e / 其它环境受益）──
  function onWindowFocus() {
    tryRestore({ requireLostFocus: true })
  }
  window.addEventListener('focus', onWindowFocus)
  cleanups.push(() => window.removeEventListener('focus', onWindowFocus))

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') tryRestore({ requireLostFocus: true })
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibilityChange))

  if (isTauriEnvironment()) {
    // WebView2 的窗口激活未必派发 DOM focus（实测），桌面端补 Tauri 的窗口焦点事件
    /**
     * WebView2 焦点链卡死自愈（2026-11-27 真机取证）：打开外链把前台让给浏览器后，
     * Chromium 的焦点认知会被冻结——DOM focus/blur 零广播、activeElement 停在旧元素
     * 上、document.hasFocus() 恒 true。窗口重新激活时键盘焦点不会回到 webview 的子
     * HWND：鼠标走命中路由一切正常，键盘走焦点链全军覆没（0 个 keydown 到达页面，
     * 连 document 捕获层都没有）。MoveFocus(Programmatic) 是官方解法。
     *
     * 两个实测约束（第三/四轮取证）：
     * 1. 窗口重新激活时 WebView2 抛的是一串 focus↔blur 抖动（85ms 内 4 条、以 blur
     *    收尾）。kick 必须等抖动**平息后拖尾**补出——在串中第一个 focus 上就踢会被
     *    收尾的 blur 打回去，等于没踢。
     * 两个实测约束（第二~四轮取证）：
     * 1. 窗口重新激活时 WebView2 抛的是一串 focus↔blur 抖动（85ms 内 4 条、以 blur
     *    收尾）。kick 必须等抖动**平息后拖尾**补出——在串中第一个 focus 上就踢会被
     *    收尾的 blur 打回去，等于没踢。
     * 2. MoveFocus 会反向触发 WebView2 的 GotFocus/LostFocus 合成事件（focus↔blur
     *    每 ~6ms 一对、无限循环，输入法工具栏因此持续闪烁）。kick 后设冷却期：冷却
     *    内到达的反射事件一律不再排程，自激环即断；真实返回（人级间隔）时冷却早已
     *    过期，不受影响。
     * 3. 冷却不能一刀切吞事件：真实返回若恰好落在冷却内（快速 alt-tab 往返）会被
     *    永久吞掉、键盘仍死。故按「反射带」区分——kick 后 200ms 内到达的事件（实测
     *    反射延迟 0~130ms）视为自激反射吞掉；带外事件视为真实抖动，推迟到冷却期满
     *    + SETTLE 再补踢。既断循环，又不吞真实返回。
     */
    const KICK_SETTLE_MS = 120
    const KICK_COOLDOWN_MS = 800
    const KICK_REFLECTION_BAND_MS = 200
    let kickTimer: ReturnType<typeof setTimeout> | null = null
    let lastKickAt = 0

    void Promise.all([
      import('@tauri-apps/api/window'),
      import('@tauri-apps/api/webview'),
    ])
      .then(([{ getCurrentWindow }, { getCurrentWebview }]) => {
        const fireKick = () => {
          kickTimer = null
          lastKickAt = Date.now()
          getCurrentWebview().setFocus().catch(() => {
            // 权限缺失或平台不支持时静默（与 external-link 同口径）
          })
        }
        /** 抖动平息后拖尾补踢；冷却期内反射带内吞掉、带外推迟补踢 */
        const scheduleTrailingKick = () => {
          if (kickTimer) {
            clearTimeout(kickTimer)
            kickTimer = null
          }
          const sinceKick = Date.now() - lastKickAt
          if (sinceKick < KICK_COOLDOWN_MS) {
            if (sinceKick >= KICK_REFLECTION_BAND_MS) {
              kickTimer = setTimeout(
                fireKick,
                KICK_COOLDOWN_MS - sinceKick + KICK_SETTLE_MS,
              )
            }
            return
          }
          kickTimer = setTimeout(fireKick, KICK_SETTLE_MS)
        }
        cleanups.push(() => {
          if (kickTimer) clearTimeout(kickTimer)
        })

        return getCurrentWindow().onFocusChanged(({ payload }) => {
          // 任何焦点事件都视为一次抖动：清掉挂起的 kick，平息后重新排程
          // （payload=false 也排程——激活串以 blur 收尾是实测常态）
          scheduleTrailingKick()
          if (payload) tryRestore({ requireLostFocus: true })
        })
      })
      .then((unlisten) => {
        if (typeof unlisten === 'function') cleanups.push(unlisten)
      })
      .catch(() => {
        // 非 Tauri 构建走到这里是配置问题，静默（与 external-link 同口径）
      })
  }

  return () => {
    disposed = true
    for (const fn of cleanups) fn()
    cleanups.length = 0
  }
}
