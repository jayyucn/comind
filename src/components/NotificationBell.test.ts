import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import NotificationBell from './NotificationBell.vue'
import { useNotificationStore } from '../stores/notification'
import type { Notification } from '../wasm/types'

// 组件静态 import useNavigateToPage（内部注入 router，测试环境无 router 会告警）
vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({ navigateToPage: vi.fn() }),
}))

// ── 背景 ────────────────────────────────────────────────
// 回归：handleDelete 后 store.deleteNotification 会触发 loadNotifications()
// （isLoading=true）——若 loading 分支在“列表已有内容”时也显示，内容驱动的
// 弹层宽度会先塌缩（一行“加载中”）再恢复（完整列表），即“闪一下”。
// 修复：loading 仅在 notifications 为空时渲染；本文件三用例锁定该判别。

function makeNotification(partial: Partial<Notification> & { id: string }): Notification {
  const payload = {
    title: '通知标题',
    body: '通知内容',
    blockSnippet: '片段',
    eventDisplay: '10:00',
    blockId: 'block-1',
    pageId: 'page-1',
    pageTitle: '页面标题',
  }
  return {
    id: partial.id,
    block_id: partial.block_id ?? 'block-1',
    page_id: partial.page_id ?? 'page-1',
    kind: partial.kind ?? 'schedule',
    event_iso: partial.event_iso ?? '2026-08-09T10:00',
    fired_at: partial.fired_at ?? Date.now() - 3600_000,
    status: partial.status ?? 'unread',
    snooze_until: partial.snooze_until ?? null,
    payload: partial.payload ?? JSON.stringify(payload),
    created_at: partial.created_at ?? 0,
    updated_at: partial.updated_at ?? 0,
  }
}

// 组件 onMounted / 展开时会真实调用 store 的 loadNotifications / loadSettings
// （内部会走 wasm client），测试中一律 spy 掉。
function spyStoreActions() {
  const store = useNotificationStore()
  vi.spyOn(store, 'loadNotifications').mockResolvedValue(undefined)
  vi.spyOn(store, 'loadSettings').mockResolvedValue(undefined)
  return store
}

let wrapper: VueWrapper | null = null

async function mountBell() {
  wrapper = mount(NotificationBell, {
    attachTo: document.body,
    global: {
      // Transition stub：让 BasePopover 面板内容立即进入 DOM，避免 jsdom 动画钩子挂起
      stubs: { Icon: true, Transition: true },
    },
  })
  await flushPromises()
  await nextTick()
  return wrapper
}

async function openDropdown() {
  await wrapper!.get('.notification-bell-btn').trigger('click')
  await flushPromises()
  await nextTick()
}

function panelContent() {
  const panel = document.querySelector('.base-popover')
  return {
    panel,
    loading: panel?.querySelector('.dropdown-loading') ?? null,
    empty: panel?.querySelector('.dropdown-empty') ?? null,
    list: panel?.querySelector('.dropdown-content') ?? null,
    items: panel?.querySelectorAll('.notification-item').length ?? 0,
  }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('NotificationBell 展开态分支渲染', () => {
  it('列表已有内容且 isLoading（删除通知后的静默刷新态）：仍渲染列表，不替换为 loading 占位', async () => {
    const store = spyStoreActions()
    store.notifications = [
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2' }),
    ]
    store.isLoading = true // 模拟 deleteNotification 内 loadNotifications 的进行中状态

    await mountBell()
    await openDropdown()

    const { loading, list, items } = panelContent()
    expect(loading).toBeNull() // 回归判别：旧代码此处会渲染“加载中...” → 宽度塌缩闪动
    expect(list).not.toBeNull()
    expect(items).toBe(2)
  })

  it('空列表且 isLoading（首次打开/清空后加载）：显示“加载中...”', async () => {
    const store = spyStoreActions()
    store.isLoading = true

    await mountBell()
    await openDropdown()

    const { loading, empty, list } = panelContent()
    expect(loading).not.toBeNull()
    expect(empty).toBeNull()
    expect(list).toBeNull()
  })

  it('空列表且非 isLoading：显示“暂无通知”', async () => {
    spyStoreActions()

    await mountBell()
    await openDropdown()

    const { loading, empty, list } = panelContent()
    expect(loading).toBeNull()
    expect(empty).not.toBeNull()
    expect(list).toBeNull()
  })
})
