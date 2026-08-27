import { isTauriEnvironment, tauriPickImageFile } from '../wasm/tauri-platform'

/**
 * 打开图片文件选择器。
 *
 * - Tauri 环境：使用原生 @tauri-apps/plugin-dialog（webview 的 <input type=file>
 *   常被拦截/不弹窗，且 change 事件不可靠），再用 plugin-fs 读字节构造 File。
 * - 浏览器环境：使用 <input type=file>。注意必须在用户手势（回车 / 点击）的
 *   同步调用栈内调用 .click()，否则会因失去 user-activation 被浏览器拦截。
 *
 * @returns 选中的图片 File；用户取消或出错时返回 null。
 */
export async function openImageFileDialog(): Promise<File | null> {
  if (isTauriEnvironment()) {
    return tauriPickImageFile()
  }
  return browserPickImage()
}

/** 浏览器兜底：原生文件选择器（仅非 Tauri 环境调用） */
function browserPickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const cleanup = () => {
      window.removeEventListener('focus', onWindowFocus)
      if (input.parentNode) input.parentNode.removeChild(input)
    }
    const done = (file: File | null) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(file)
    }

    // 选定文件：change 始终在对话框关闭、焦点回到页面时触发。
    // 用 microtask 包裹，确保它一定先于下方的 focus 取消判定（setTimeout 宏任务）执行，
    // 避免「选中文件却误判为取消」。
    input.addEventListener('change', () => {
      Promise.resolve().then(() => done(input.files?.[0] ?? null))
    })
    // 部分浏览器取消时触发 cancel
    input.addEventListener('cancel', () => done(null))

    // 兜底：对话框关闭（无论确认/取消）后焦点回到页面触发 focus。
    // 延迟一拍（宏任务）再判定取消，若 change 已抢先 settle 则不会误杀。
    // 注意：不能用 blur —— 打开对话框时页面也会失焦，会误判取消。
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled) done(null)
      }, 0)
    }
    window.addEventListener('focus', onWindowFocus)

    // 关键：必须在手势同步栈内调用，且此前无任何 await
    input.click()
  })
}
