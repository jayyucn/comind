import { computed, ref, type ComputedRef } from 'vue'
import { BUILTIN_TEMPLATES } from '../config/builtin-templates'
import type { NormalizedTemplate, BuiltinTemplate, UserTemplate } from '../types/template'
import { useUserTemplatesStore } from '../stores/user-templates'

/**
 * 模板注册表 composable
 *
 * 职责：
 * 1. 合并内置 + 用户模板为统一的 NormalizedTemplate[]
 * 2. 提供 getById / searchByText 查询接口
 * 3. 用户模板 ID 加 `user:` 前缀避免与内置冲突
 * 4. 同 ID 时用户模板优先（最新创建）
 */

// 模块级共享 state —— 多次调用 useTemplateRegistry() 必须返回同一个 ref，
// 否则多个消费者各自刷新数据时会出现"一个拿到数据、一个拿到空"的 bug
// （见 SlashCommandMenu 中 buildTemplateCommands() 与 onMounted 的实例不一致问题）
const all = ref<NormalizedTemplate[]>([])
const loaded = ref(false)

export function useTemplateRegistry() {
  const userStore = useUserTemplatesStore()

  const builtinAsNormalized: NormalizedTemplate[] = BUILTIN_TEMPLATES.map((t: BuiltinTemplate) => ({
    id: t.id,
    name: t.name,
    aliases: t.aliases,
    category: t.category,
    description: t.description,
    icon: t.icon,
    source: 'builtin' as const,
    blocks: t.blocks,
  }))

  /**
   * 加载并合并所有模板。
   * 每次调用都重新计算（用户模板变化时需重调）。
   */
  async function loadAll(): Promise<NormalizedTemplate[]> {
    if (!userStore.templates || userStore.templates.length === 0) {
      // 仍然尝试从 db 加载（兜底）
      try {
        await userStore.loadAll()
      } catch {
        // 忽略
      }
    }

    const userAsNormalized: NormalizedTemplate[] = userStore.templates.map((t: UserTemplate) => ({
      id: `user:${t.id}`,
      name: t.name,
      aliases: undefined,
      category: t.category,
      description: t.description ?? '',
      icon: '📄',
      source: 'user' as const,
      blocks: t.blocks,
    }))

    // 用户模板排前，内置模板在后
    all.value = [...userAsNormalized, ...builtinAsNormalized]
    loaded.value = true
    return all.value
  }

  function getById(id: string): NormalizedTemplate | undefined {
    return all.value.find(t => t.id === id)
  }

  function searchByText(query: string): NormalizedTemplate[] {
    if (!query) return all.value
    const lower = query.toLowerCase()
    return all.value.filter(t => {
      if (t.name.toLowerCase().includes(lower)) return true
      if (t.description.toLowerCase().includes(lower)) return true
      if (t.aliases?.some(a => a.toLowerCase().includes(lower))) return true
      return false
    })
  }

  const isLoaded: ComputedRef<boolean> = computed(() => loaded.value)

  return { all, isLoaded, loadAll, getById, searchByText }
}
