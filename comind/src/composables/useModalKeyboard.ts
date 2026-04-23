import { onMounted, onUnmounted, watch, type Ref } from 'vue'

// 全局模态栈（不依赖任何 editor 实例，模块级单例）
const globalModalStack = new Set<string>()

/**
 * 检查当前是否有模态层打开
 * 供 EnterAsBlockExtension 或其他需要的地方调用
 */
export function hasModalOpen(): boolean {
  return globalModalStack.size > 0
}

/**
 * 获取当前模态栈的只读快照（调试用）
 */
export function getModalStack(): string[] {
  return Array.from(globalModalStack)
}

/**
 * 手动 push 模态层到栈
 */
export function pushModal(modalName: string) {
  globalModalStack.add(modalName)
  document.dispatchEvent(new CustomEvent('modal-keyboard-push', {
    detail: { name: modalName, stack: Array.from(globalModalStack) }
  }))
}

/**
 * 手动 pop 模态层从栈
 */
export function popModal(modalName: string) {
  globalModalStack.delete(modalName)
  document.dispatchEvent(new CustomEvent('modal-keyboard-pop', {
    detail: { name: modalName, stack: Array.from(globalModalStack) }
  }))
}

/**
 * 注册模态键盘拦截层（基于组件生命周期）
 *
 * 用法：在模态组件 setup 中调用 useModalKeyboard('unique-name')
 * 组件挂载时自动注册，卸载时自动注销
 *
 * 注意：仅适用于条件渲染的模态组件（v-if）。
 * 如果组件常驻（如 SlashCommandMenu），请用 useModalKeyboardRef 或手动 push/pop。
 */
export function useModalKeyboard(modalName: string) {
  onMounted(() => pushModal(modalName))
  onUnmounted(() => popModal(modalName))

  return { pushModal: () => pushModal(modalName), popModal: () => popModal(modalName) }
}

/**
 * 注册模态键盘拦截层（基于 Ref 状态）
 *
 * 用法：在常驻模态组件中，传入 visible Ref
 * visible = true 时 push，visible = false 时 pop
 */
export function useModalKeyboardRef(modalName: string, visible: Ref<boolean>) {
  watch(visible, (isVisible) => {
    if (isVisible) {
      pushModal(modalName)
    } else {
      popModal(modalName)
    }
  }, { immediate: true })

  // 组件卸载时确保清理
  onUnmounted(() => popModal(modalName))

  return { pushModal: () => pushModal(modalName), popModal: () => popModal(modalName) }
}
