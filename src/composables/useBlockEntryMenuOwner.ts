import { ref } from 'vue'

/**
 * 块入口菜单的「谁开着」所有权（模块级单例）。
 *
 * hover 就能弹菜单之后，「同时只有一个」从约定变成了必须：指针从 A 块的入口胶囊扫到
 * B 块，A 的菜单若不收起，页面上就并排挂着两个菜单，各自钉在自己的图标下 —— 读不出
 * 哪个属于哪块。所有 Block 实例订阅这一格，非自己开的那份立即收起。
 *
 * 存**实例令牌**而不是 blockId：双 pane 同页时同一个块有两个 Block 实例，
 * 按 id 判等会让两份菜单都认为「是我开的」而同时展开。
 */
const owner = ref<symbol | null>(null)

export function useBlockEntryMenuOwner() {
  return owner
}
