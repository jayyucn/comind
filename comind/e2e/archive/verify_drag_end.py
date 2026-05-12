"""验证: 拖拽到列表底部外的极端情况"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5173"

def clear_idb(p):
    p.evaluate("() => { indexedDB.deleteDatabase('comind'); }")
    time.sleep(0.2)

def get_blocks(p):
    return p.evaluate("""() => {
        return Array.from(document.querySelectorAll('.block-content')).map(el => el.textContent.trim());
    }""")

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp("http://localhost:9222")
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(BASE, timeout=15000)
    page.wait_for_load_state("networkidle", timeout=15000)
    time.sleep(0.8)

    clear_idb(page)
    page.reload()
    time.sleep(0.8)

    # 输入 A, B, C
    page.locator(".block-content").first.click()
    time.sleep(0.15)
    page.keyboard.type("A")
    page.keyboard.press("Enter")
    time.sleep(0.15)
    page.keyboard.type("B")
    page.keyboard.press("Enter")
    time.sleep(0.15)
    page.keyboard.type("C")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # 获取 BlockList 容器 bounding box
    list_box = page.locator(".block-list").bounding_box()
    print(f"BlockList: y={list_box['y']}, height={list_box['height']}, bottom={list_box['y']+list_box['height']}")

    # 获取 bullet 位置
    bullet_A = page.locator(".block-bullet").first
    b_A = bullet_A.bounding_box()
    print(f"A bullet: y={b_A['y']}")

    # 方案: 拖到 BlockList 容器底部之外 80px
    target_y = list_box["y"] + list_box["height"] + 80
    print(f"拖到 y={target_y} (BlockList底部外80px)")

    start_x = b_A["x"] + b_A["width"]/2
    start_y = b_A["y"] + b_A["height"]/2

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    time.sleep(0.1)
    page.mouse.move(start_x, target_y, steps=15)
    time.sleep(0.1)
    page.mouse.up()
    time.sleep(0.6)

    print(f"拖后: {get_blocks(page)}")
    # 期望是 B, C, A - 但由于这个 bug 可能仍然是 B, A, C

    ctx.close()
    browser.close()