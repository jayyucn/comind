"""简单测试 - 验证 Playwright 环境"""
from playwright.sync_api import sync_playwright
import time

BASE_URL = "http://localhost:5175"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    print("正在访问页面...")
    page.goto(BASE_URL)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)
    
    title = page.title()
    print(f"页面标题: {title}")
    
    # 检查是否存在 block-content
    blocks = page.locator('.block-content').count()
    print(f"找到 {blocks} 个 block-content 元素")
    
    browser.close()
    print("测试完成")
