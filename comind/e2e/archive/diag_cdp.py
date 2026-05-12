"""诊断 - 验证 Playwright + comind 页面交互"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5175"

def main():
    print("=== 诊断测试 ===")
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://localhost:9222")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        print(f"打开 {BASE}...")
        page.goto(BASE, timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(1)

        # 1. 查看初始 DOM
        block_count = page.locator(".block").count()
        print(f"初始 block 数: {block_count}")

        content_count = page.locator(".block-content").count()
        print(f"初始 block-content 数: {content_count}")

        # 2. 点击第一个 block-content，输入文字
        first_content = page.locator(".block-content").first
        print(f"点击第一个 block-content...")
        first_content.click()
        time.sleep(0.2)

        # 3. 检查焦点
        active = page.evaluate("() => document.activeElement?.className")
        print(f"当前焦点元素: {active}")

        # 4. 输入文字
        print("输入 'Alpha'...")
        page.keyboard.type("Alpha")
        time.sleep(0.2)

        # 5. 检查内容
        texts = page.evaluate("() => Array.from(document.querySelectorAll('.block-content')).map(e => e.textContent)")
        print(f"当前 block-content 文本: {texts}")

        # 6. 按 Enter 创建新块
        print("按 Enter...")
        page.keyboard.press("Enter")
        time.sleep(0.3)

        texts2 = page.evaluate("() => Array.from(document.querySelectorAll('.block-content')).map(e => e.textContent)")
        print(f"按 Enter 后: {texts2}")

        # 7. 输入第二个文字
        page.keyboard.type("Beta")
        time.sleep(0.2)

        texts3 = page.evaluate("() => Array.from(document.querySelectorAll('.block-content')).map(e => e.textContent)")
        print(f"输入 Beta 后: {texts3}")

        # 8. 按 Escape
        page.keyboard.press("Escape")
        time.sleep(0.5)

        texts4 = page.evaluate("() => Array.from(document.querySelectorAll('.block-content')).map(e => e.textContent)")
        print(f"按 Escape 后: {texts4}")

        # 9. 测试 locator 能否找到文字
        try:
            loc = page.locator(".block:has(.block-content >> text=Alpha)").first
            box = loc.bounding_box(timeout=5000)
            print(f"Alpha block bounding_box: {box}")
        except Exception as e:
            print(f"Alpha 定位失败: {e}")

        try:
            loc2 = page.locator("text=Alpha").first
            box2 = loc2.bounding_box(timeout=5000)
            print(f"text=Alpha bounding_box: {box2}")
        except Exception as e:
            print(f"text=Alpha 定位失败: {e}")

        # 10. 测试拖拽 - 用 mouse API 直接拖
        print("\n=== 拖拽测试 ===")
        bullet = page.locator(".block-bullet").first
        b = bullet.bounding_box(timeout=5000)
        print(f"Bullet bbox: {b}")
        if b:
            cx, cy = b["x"] + b["width"]/2, b["y"] + b["height"]/2
            print(f"开始拖拽从 ({cx:.0f}, {cy:.0f})...")
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + 50, cy + 60, steps=8)
            page.mouse.up()
            time.sleep(0.3)
            drag_class = page.evaluate("() => !!document.querySelector('.block-drag')")
            print(f"拖拽中 .block-drag 存在: {drag_class}")

        ctx.close()
        browser.close()
    print("=== 完成 ===")

if __name__ == "__main__":
    main()