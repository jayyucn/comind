"""最小测试 - 验证 Playwright + 服务器"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("http://localhost:5175")
    page.wait_for_load_state('networkidle')
    print(f"页面标题: {page.title()}")
    blocks = page.locator('.block-content').count()
    print(f"找到 {blocks} 个 block")
    browser.close()
    print("完成")