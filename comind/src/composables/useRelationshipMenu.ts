import { ref, computed } from 'vue'
import { PREDEFINED_RELATIONSHIPS } from '../types/relationship'

export interface RelationshipMenuOpenOpts {
  view: { dom: { isConnected: boolean } }
  position: { x: number; y: number }
  range: { from: number; to: number }
  initialQuery?: string
  currentType?: string
  onSelect: (type: string) => void
}

export interface RelationshipMenuState {
  visible: boolean
  position: { x: number; y: number } | null
  range: { from: number; to: number } | null
  query: string
  selectedIndex: number
  currentType: string | null
  onSelect: ((type: string) => void) | null
}

const initialState: RelationshipMenuState = {
  visible: false,
  position: null,
  range: null,
  query: '',
  selectedIndex: 0,
  currentType: null,
  onSelect: null
}

export function useRelationshipMenu() {
  const state = ref<RelationshipMenuState>({ ...initialState })

  const items = computed(() => {
    if (!state.value.query) return PREDEFINED_RELATIONSHIPS
    const q = state.value.query.toLowerCase()
    return PREDEFINED_RELATIONSHIPS.filter(r =>
      r.type.toLowerCase().includes(q)
    )
  })

  function open(opts: RelationshipMenuOpenOpts) {
    if (!opts.view?.dom?.isConnected) return
    if (state.value.visible) close()

    const currentType = opts.currentType ?? null
    const currentTypeIndex = currentType
      ? PREDEFINED_RELATIONSHIPS.findIndex(r => r.type === currentType)
      : -1

    state.value = {
      visible: true,
      position: opts.position,
      range: opts.range,
      query: opts.initialQuery ?? '',
      selectedIndex: currentTypeIndex >= 0 ? currentTypeIndex : 0,
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
    state.value.selectedIndex = 0
  }

  function setSelectedIndex(index: number) {
    const max = items.value.length - 1
    if (max < 0) {
      state.value.selectedIndex = 0
      return
    }
    state.value.selectedIndex = Math.max(0, Math.min(index, max))
  }

  function moveSelection(delta: number) {
    setSelectedIndex(state.value.selectedIndex + delta)
  }

  function select() {
    const item = items.value[state.value.selectedIndex]
    if (!item) return
    const onSelect = state.value.onSelect
    const type = item.type
    close()
    onSelect?.(type)
  }

  return { state, items, open, openSwitch, close, setQuery, setSelectedIndex, moveSelection, select }
}
