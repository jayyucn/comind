import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/**
 * 布局壳：把「布局元素的真实 DOM 引用」集中由真正的 owner 写入，
 * 取代 Toc 原先跨组件用 document.querySelector 全局抓取 .sidebar / .main-content / .content-body
 * （见 code-review 指出的 #1 耦合问题）。
 *
 * - App 提供壳，并写入自身持有的 .content-body；
 * - SidebarContainer 写入 .sidebar；
 * - Page 写入其 .main-content（TOC 据其左缘定位）。
 * Toc 只 inject 读取，不再依赖任何全局 class 名。
 */
export interface LayoutShell {
  /** 侧栏根元素（SidebarContainer 写入） */
  sidebarEl: Ref<HTMLElement | null>
  /** 主内容体容器（App 写入，侧栏/右侧栏开合改变其宽度） */
  contentBodyEl: Ref<HTMLElement | null>
  /** 页面正文列（Page 写入，TOC 据其左缘定位） */
  pageMainContentEl: Ref<HTMLElement | null>
}

const KEY: InjectionKey<LayoutShell> = Symbol('layout-shell')

// 无 provider 时的兜底壳（孤立单测 / 阅读器窗口等场景）：所有 ref 恒为 null，
// 消费方据此降级为隐藏，不抛错。生产环境由 App 提供真实壳。
const FALLBACK: LayoutShell = {
  sidebarEl: ref<HTMLElement | null>(null),
  contentBodyEl: ref<HTMLElement | null>(null),
  pageMainContentEl: ref<HTMLElement | null>(null),
}

export function provideLayoutShell(shell: LayoutShell): void {
  provide(KEY, shell)
}

export function useLayoutShell(): LayoutShell {
  return inject(KEY, FALLBACK)
}
