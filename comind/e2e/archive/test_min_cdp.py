"""最小测试 - 验证 Playwright + Chrome CDP 连接"""
from playwright.sync_api import sync_playwright

print("尝试连接 Chrome CDP...")
with sync_playwright() as p:
    print("创建浏览器连接...")
    browser = p.chromium.connect_over_cdp("http://localhost:9222")
    print(f"已连接: {browser}")
    
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    print("新建页面...")
    
    print("访问 localhost:5175...")
    page.goto("http://localhost:5175", timeout=10000)
    print(f"页面标题: {page.title()}")
    
    blocks = page.locator(".block-content").count()
    print(f"找到 {blocks} 个 block-content")
    
    browser.close()
    print("完成")