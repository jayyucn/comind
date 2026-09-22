import { useRouter } from 'vue-router'

/**
 * 标签导航工具函数（ADR-0050 D5/D7）
 *
 * 与 `useNavigateToPage` 同构：只做路由跳转封装，数据加载由目标页面自身负责。
 *
 * 使用场景：
 * - inline `#tag` chip 点击 → 该 tag 的聚合页
 * - 标签管理页行点击 → 该 tag 的聚合页
 * - 聚合页面包屑 → 返回标签管理页
 */
export function useNavigateToTag() {
  const router = useRouter()

  /** 导航到指定 tag 的聚合页（tagId 为空时 no-op，避免误跳 `/tags/` 空参路由）。 */
  async function navigateToTag(tagId: string): Promise<void> {
    if (!tagId) return
    await router.push(`/tags/${encodeURIComponent(tagId)}`)
  }

  /** 导航到标签管理页。 */
  async function navigateToTagLibrary(): Promise<void> {
    await router.push('/tags')
  }

  return { navigateToTag, navigateToTagLibrary }
}
