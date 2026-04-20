/**
 * 防抖工具（支持取消）
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { fn(...args); timer = null }, delay)
  };
  (debounced as unknown as { cancel: () => void }).cancel = () => {
    if (timer) { clearTimeout(timer); timer = null }
  }
  return debounced as T & { cancel: () => void }
}
