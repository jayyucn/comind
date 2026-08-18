import { onMounted, onBeforeUnmount } from 'vue'

/**
 * 在元素上统一注册一组 DOM 事件，并在组件卸载时自动清理。
 *
 * 替代手写「onMounted 14 个 addEventListener + onBeforeUnmount 14 个
 * removeEventListener」的镜像块（Vue 不会自动清理模板外 DOM 监听器，
 * 不清理会内存泄漏）。事件表由调用方以 getter 形式传入，因此本 composable
 * 在 setup 阶段注册生命周期钩子，实际增删发生在 mounted/unmounted。
 *
 * @param getTarget 返回要注册事件的 DOM 元素（组件挂载后才可用）
 * @param getEvents 返回事件名 → handler 的声明式表
 */
export function useDomEvents(
  getTarget: () => HTMLElement | null,
  getEvents: () => Record<string, (e: Event) => void>
) {
  let target: HTMLElement | null = null
  let entries: [string, (e: Event) => void][] = []

  onMounted(() => {
    target = getTarget()
    if (!target) return
    entries = Object.entries(getEvents())
    for (const [name, handler] of entries) {
      target.addEventListener(name, handler)
    }
  })

  onBeforeUnmount(() => {
    if (!target) return
    for (const [name, handler] of entries) {
      target.removeEventListener(name, handler)
    }
    target = null
    entries = []
  })
}
