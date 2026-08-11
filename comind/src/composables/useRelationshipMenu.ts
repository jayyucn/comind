import { ref, computed } from 'vue'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getGroupByType, getDirectionInGroup, type RelationshipGroup } from '../types/relationship'

export interface RelationshipMenuOpenOpts {
  // Tiptap EditorView 兼容（自带 .dom.isConnected），
  // 或测试桩 { dom: { isConnected: boolean } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view: any
  position: { x: number; y: number }
  range: { from: number; to: number }
  initialQuery?: string
  currentType?: string
  onSelect: (type: string) => void
}

export type RelationshipDirection = 'forward' | 'inverse'

export interface RelationshipMenuState {
  visible: boolean
  position: { x: number; y: number } | null
  range: { from: number; to: number } | null
  query: string
  /** 选中的关系组下标（0 ~ items.length-1） */
  selectedGroupIndex: number
  /** 选中的方向：正向或反向。自反组只有 forward 有效。 */
  selectedDirection: RelationshipDirection
  currentType: string | null
  onSelect: ((type: string) => void) | null
}

const initialState: RelationshipMenuState = {
  visible: false,
  position: null,
  range: null,
  query: '',
  selectedGroupIndex: 0,
  selectedDirection: 'forward',
  currentType: null,
  onSelect: null
}

// 单例 state：app 端只有一个菜单实例；测试通过 close() 显式重置可避免污染。
const state = ref<RelationshipMenuState>({ ...initialState })

/**
 * 文档级键盘处理：单例 attach，避免多组件实例叠加监听器。
 * 由 RelationshipMenu 组件在 onMounted / onBeforeUnmount 调用。
 */
function handleKeydown(event: KeyboardEvent) {
  if (!state.value.visible) return
  const m = currentInstance?.value
  if (!m) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      event.stopPropagation()
      m.moveGroup(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      event.stopPropagation()
      m.moveGroup(-1)
      break
    case 'ArrowRight':
      event.preventDefault()
      event.stopPropagation()
      m.setDirection('inverse')
      break
    case 'ArrowLeft':
      event.preventDefault()
      event.stopPropagation()
      m.setDirection('forward')
      break
    case 'Enter':
      event.preventDefault()
      event.stopPropagation()
      m.select()
      break
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      m.close()
      break
  }
}

const currentInstance = ref<ReturnType<typeof useRelationshipMenu> | null>(null)
let listenerCount = 0

function attachKeyboardListener(instance: ReturnType<typeof useRelationshipMenu>) {
  currentInstance.value = instance
  if (listenerCount === 0) {
    document.addEventListener('keydown', handleKeydown, true)
  }
  listenerCount++
}

function detachKeyboardListener() {
  listenerCount = Math.max(0, listenerCount - 1)
  if (listenerCount === 0) {
    document.removeEventListener('keydown', handleKeydown, true)
    currentInstance.value = null
  }
}

export function useRelationshipMenu() {
  // 过滤后的组
  const items = computed<RelationshipGroup[]>(() => {
    const all = useRelationshipTypes().items.value
    if (!state.value.query) return all
    const q = state.value.query.toLowerCase()
    return all.filter(g => {
      if (g.type.toLowerCase().includes(q)) return true
      if (g.inverse && g.inverse.toLowerCase().includes(q)) return true
      if (g.label.includes(q)) return true
      if (g.inverseLabel.includes(q)) return true
      return false
    })
  })

  function open(opts: RelationshipMenuOpenOpts) {
    if (!opts.view?.dom?.isConnected) return
    if (state.value.visible) close()

    const currentType = opts.currentType ?? null
    let selectedGroupIndex = 0
    let selectedDirection: RelationshipDirection = 'forward'

    if (currentType) {
      const group = getGroupByType(currentType)
      const dir = getDirectionInGroup(currentType)
      if (group && dir) {
        const all = useRelationshipTypes().items.value
        const idx = all.findIndex(g => g.type === group.type)
        if (idx >= 0) {
          selectedGroupIndex = idx
          selectedDirection = dir
        }
      }
    }

    state.value = {
      visible: true,
      position: opts.position,
      range: opts.range,
      query: opts.initialQuery ?? '',
      selectedGroupIndex,
      selectedDirection,
      currentType,
      onSelect: opts.onSelect
    }
  }

  function openSwitch(opts: Omit<RelationshipMenuOpenOpts, 'initialQuery'> & { currentType: string }) {
    open(opts)
  }

  function close() {
    state.value = { ...initialState }
  }

  function setQuery(query: string) {
    state.value.query = query.replace(/\n/g, '')
    state.value.selectedGroupIndex = 0
    state.value.selectedDirection = 'forward'
  }

  function setSelectedGroupIndex(index: number) {
    const max = items.value.length - 1
    if (max < 0) {
      state.value.selectedGroupIndex = 0
      return
    }
    // 环绕：超过末尾回到首部；负数从尾部向前数
    const len = max + 1
    const wrapped = ((index % len) + len) % len
    state.value.selectedGroupIndex = wrapped
    // 切换组后，若新组是自反，确保方向是 forward
    const group = items.value[state.value.selectedGroupIndex]
    if (group && group.inverse === null) {
      state.value.selectedDirection = 'forward'
    }
  }

  function moveGroup(delta: number) {
    setSelectedGroupIndex(state.value.selectedGroupIndex + delta)
  }

  function setDirection(direction: RelationshipDirection) {
    const group = items.value[state.value.selectedGroupIndex]
    if (!group) return
    if (group.inverse === null) {
      // 自反组只能 forward
      state.value.selectedDirection = 'forward'
      return
    }
    state.value.selectedDirection = direction
  }

  function toggleDirection() {
    const group = items.value[state.value.selectedGroupIndex]
    if (!group || group.inverse === null) return
    setDirection(state.value.selectedDirection === 'forward' ? 'inverse' : 'forward')
  }

  /** 把 (group, direction) 解析为实际 type */
  function resolveLabel(): string | null {
    const group = items.value[state.value.selectedGroupIndex]
    if (!group) return null
    if (state.value.selectedDirection === 'inverse' && group.inverseLabel) {
      return group.inverseLabel
    }
    return group.label
  }

  function select() {
    const type = resolveLabel()
    if (!type) return
    const onSelect = state.value.onSelect
    close()
    onSelect?.(type)
  }

  return {
    state,
    items,
    open,
    openSwitch,
    close,
    setQuery,
    setSelectedGroupIndex,
    moveGroup,
    setDirection,
    toggleDirection,
    resolveType: resolveLabel,
    select
  }
}

export { attachKeyboardListener, detachKeyboardListener }
