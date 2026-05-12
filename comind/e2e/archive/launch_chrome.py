"""Launch Chrome with CDP debugging port"""
import subprocess, time, os

chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
user_data_dir = r"C:\Users\jay\AppData\Local\Temp\comind-cdp-test"
os.makedirs(user_data_dir, exist_ok=True)

print("启动 Chrome...")
proc = subprocess.Popen(
    [chrome_path,
     "--no-sandbox",
     "--remote-debugging-port=9222",
     f"--user-data-dir={user_data_dir}",
     "--no-first-run",
     "--no-default-browser-check",
     "--disable-infobars",
     "--disable-extensions",
     "--disable-background-networking",
     "--disable-sync",
     "--disable-default-apps",
     "--noerrdialogs"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
)
print(f"PID: {proc.pid}")

print("等待 5 秒...")
time.sleep(5)

# Check if still running
if proc.poll() is not None:
    print(f"Chrome 已退出，exit code: {proc.returncode}")
else:
    print("Chrome 仍在运行")
    # Check port
    import urllib.request
    try:
        resp = urllib.request.urlopen("http://localhost:9222/json/version", timeout=3)
        print(f"CDP 响应: {resp.read().decode()}")
    except Exception as e:
        print(f"CDP 检查失败: {e}")