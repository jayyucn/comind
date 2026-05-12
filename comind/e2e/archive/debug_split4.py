"""逐帧调试 Enter Split"""
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    page.locator('.add-block-btn').click()
    page.wait_for_timeout(500)

    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    tiptap = page.locator('.block.active .tiptap')
    tiptap.click()
    page.keyboard.type('Hello World')
    page.wait_for_timeout(300)

    # 移动光标到中间
    page.keyboard.press('Home')
    for _ in range(5):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(100)

    def snapshot(label):
        blocks = page.locator('.block').all()
        active_count = page.locator('.block.active').count()
        texts = []
        for b in blocks:
            bt = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else ''
            ed = b.locator('.tiptap').count()
            cls = b.get_attribute('class') or ''
            texts.append(f"'{bt[:15]}'(active={'Y' if 'active' in cls else 'N'},ed={ed})")
        print(f"  t={time.time():.2f} {label}: [{', '.join(texts)}]")

    snapshot("ENTER前")

    # 按 Enter
    page.keyboard.press('Enter')

    for i in range(1, 11):
        page.wait_for_timeout(100)
        snapshot(f"ENTER+{i*100}ms")

    page.screenshot(path='e2e/screenshots/debug4_final.png', full_page=True)
    browser.close()
