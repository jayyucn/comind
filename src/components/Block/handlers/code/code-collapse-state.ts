/**
 * 代码块折叠状态（页面内持久化）
 *
 * CodeMirrorEditor 会随 block 的 isActive/readonly 切换而重挂载（v-if 分支切换，
 * 组件实例销毁重建），组件内的局部 ref 会随之丢失。此 Map 按 blockId 记录
 * 折叠状态，保证同一页面内组件重挂载后折叠状态不丢失。
 *
 * 仅内存态：不写后端，页面刷新即重置，符合「本页面内保存」的需求。
 */
export const codeCollapseState = new Map<string, boolean>()
