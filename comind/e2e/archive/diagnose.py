# 诊断测试：直接读页面 DOM 状态，理解 Block 渲染行为
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, Page


def diagnose_block_state(page: Page, label: str):
    """打印当前所有 Block 的 DOM 状态"""
    print(f'\n  === {label} ===')
    blocks = page.locator('.block').all()
    print(f'  Block 数量: {len(blocks)}')
    for i, block in enumerate(blocks):
        is_active = block.locator('.editor-wrapper').count() > 0
        text_el = block.locator('.block-text')
        tiptap_el = block.locator('.tiptap')
        
        block_text = ''
        tiptap_text = ''
        if text_el.count() > 0:
            block_text = text_el.first.inner_text()
        if tiptap_el.count() > 0:
            tiptap_text = tiptap_el.first.inner_text()
        
        active_class = 'active' if is_active else ''
        print(f'  Block[{i}]: {active_class}')
        print(f'    .block-text: "{block_text}"')
        print(f'    .tiptap:     "{tiptap_text}"')
        print(f'    .editor-wrapper: {block.locator(".editor-wrapper").count()}')
        print(f'    .block-row: {block.locator(".block-row").count()}')


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        
        # Step 1: 初始状态
        diagnose_block_state(page, '初始状态')
        
        # Step 2: 点击第一个 block 输入内容
        page.locator('.block-content').first.click()
        page.wait_for_timeout(500)
        diagnose_block_state(page, '激活第一个 Block（输入前）')
        
        page.keyboard.type('hello')
        page.wait_for_timeout(200)
        diagnose_block_state(page, '输入 hello 后')
        
        page.keyboard.press('Escape')  # 失活
        page.wait_for_timeout(500)
        diagnose_block_state(page, '按 Escape 后（失活）')
        
        # Step 3: 再激活 A，按 Enter split
        page.locator('.block-content').first.click()
        page.wait_for_timeout(500)
        diagnose_block_state(page, '重新激活 A（split 前）')
        
        page.keyboard.press('Enter')
        page.wait_for_timeout(500)
        diagnose_block_state(page, '按 Enter 后（应 split 出 B）')
        
        # Step 4: 输入内容到 B
        page.keyboard.type('world')
        page.wait_for_timeout(200)
        diagnose_block_state(page, 'B 输入 world 后')
        
        # Step 5: 移到 B 开头
        page.keyboard.press('Home')
        page.wait_for_timeout(200)
        diagnose_block_state(page, 'B 光标移到开头后')
        
        # Step 6: 按 Backspace
        page.keyboard.press('Backspace')
        page.wait_for_timeout(500)
        diagnose_block_state(page, '按 Backspace 后（应合并）')
        
        # 输出 page source 小片段
        html = page.content()
        # 找 block-list 部分
        import re
        match = re.search(r'<div class="block-list">.*?</div>\s*</main>', html, re.DOTALL)
        if match:
            print(f'\n  === block-list HTML ===')
            print(match.group(0)[:2000])
        
        browser.close()


if __name__ == '__main__':
    main()
