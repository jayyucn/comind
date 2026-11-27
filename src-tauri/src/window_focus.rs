//! 把主窗口抢回前台（ADR-0069 D6）。
//!
//! 为什么需要它：外链交给系统浏览器（`openUrl` → ShellExecute）后，浏览器启动时
//! 自己会取前台。而 Windows 的前台锁（foreground lock）只允许「当前前台进程 /
//! 刚收到输入的进程 / 前台进程启动的子进程」调用 `SetForegroundWindow`——
//! 浏览器一旦成为前台，我们再调 tauri 的 `set_focus()` 多半被静默拒绝，
//! 表现是任务栏按钮闪一下、焦点仍在浏览器。
//!
//! 经典解法：把本线程的输入队列临时挂到当前前台窗口的输入线程上
//! （`AttachThreadInput`），此时 `SetForegroundWindow` 才被允许，随后解除挂接。
//! 不挂接时这一步会失败，挂接后成功率高得多；对已经在前台的情况直接返回。

use tauri::{AppHandle, Manager};

/// 把 `main` 窗口抢回前台。幂等：已经在前台时什么也不做。
pub fn focus_main(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        platform::force_foreground(hwnd.0 as isize);
        // 窗口回到前台只是第一步：键盘焦点还在 WebView2 子窗口之外，
        // 不补这一下就会「窗口在前台、却要点一下才打得进字」。
        let webview: &tauri::Webview = window.as_ref();
        let _ = webview.set_focus();
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux：窗口由同一个应用持有，直接 set_focus 即可。
        window.set_focus().map_err(|e| e.to_string())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    /// Win32 `HWND`：与 `windows` crate 的 `HWND(*mut c_void)` 布局一致。
    type Hwnd = isize;

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
        fn AttachThreadInput(id_attach: u32, id_attach_to: u32, attach: i32) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn BringWindowToTop(hwnd: Hwnd) -> i32;
        fn IsIconic(hwnd: Hwnd) -> i32;
        fn ShowWindow(hwnd: Hwnd, cmd: i32) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    const SW_RESTORE: i32 = 9;

    pub(super) fn force_foreground(hwnd: Hwnd) {
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            let foreground = GetForegroundWindow();
            if foreground == hwnd {
                return;
            }
            let foreground_thread = GetWindowThreadProcessId(foreground, std::ptr::null_mut());
            let current_thread = GetCurrentThreadId();
            let attached = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, 1) != 0;
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            if attached {
                AttachThreadInput(current_thread, foreground_thread, 0);
            }
        }
    }
}
