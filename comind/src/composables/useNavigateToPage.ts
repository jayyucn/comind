import { useRouter } from 'vue-router'
import { normalizeJournalTitle } from '../utils/journal-detect'

/**
 * 页面导航工具函数
 * 
 * 设计说明：
 * - 核心逻辑（查找 + 创建）已移至 routes.ts 的 beforeEnter 守卫
 * - 此 composable 简化为路由跳转封装
 * - beforeEnter 会自动处理：页面查找、IDB fallback、隐式创建、数据加载
 * 
 * 使用场景：
 * - WikiLink 点击：[[页面名]]
 * - 命令面板搜索结果点击
 * - 其他需要导航到指定页面的场景
 */
export function useNavigateToPage() {
  const router = useRouter()

  /**
   * 导航到指定页面
   * @param pageName 页面名称（可以是 UUID、标题或日记日期）
   * 
   * 流程：
   * 1. 规范化日记标题（如 "2026/04/26" → "2026-04-26"）
   * 2. 根据标题类型选择路由（ideas → /ideas/:date，normal → /page/:pageId）
   * 3. beforeEnter 守卫自动处理：查找/创建页面、加载数据
   */
  async function navigateToPage(pageName: string): Promise<void> {
    const normalized = normalizeJournalTitle(pageName)
    const lookupTitle = normalized ?? pageName
    const isIdeas = normalized !== null

    // 直接路由跳转，beforeEnter 会自动处理一切
    if (isIdeas) {
      await router.push(`/ideas/${encodeURIComponent(lookupTitle)}`)
    } else {
      await router.push(`/page/${encodeURIComponent(lookupTitle)}`)
    }
  }

  return { navigateToPage }
}
