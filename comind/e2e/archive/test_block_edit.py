"""
comind Block 编辑器 E2E 测试
验证 Enter/Backspace/Tab 行为

运行方式：
    python e2e/test_block_edit.py

依赖：
    pip install playwright
    playwright install chromium
"""

import sys
from pathlib import Path

# 添加项目根目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def screenshot(page, name: str):
    """保存截图到 e2e/screenshots/"""
    out = Path(__file__).parent / 'screenshots' / f'{name}.png'
    out.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(out), full_page=True)
    print(f'  📸 截图: {out}')


def create_first_block(page):
    """创建第一个 Block（初始状态为空）"""
    page.locator('.add-block-btn').click()
    page.wait_for_timeout(300)
    # 确认有 .block 出现
    assert page.locator('.block').count() > 0, 'Block 未创建成功'


def test_discover_selectors():
    """Step 0: 确认实际 DOM 选择器"""
    print('\n=== [Discover] 确认选择器 ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # 打印页面元素结构
        print(f'  .add-block-btn: {page.locator(".add-block-btn").count()}')
        print(f'  .block-list: {page.locator(".block-list").count()}')
        print(f'  .block: {page.locator(".block").count()}')

        # 创建第一个 Block
        create_first_block(page)
        screenshot(page, '00_after_create_first_block')

        # 打印所有 .block 元素
        blocks = page.locator('.block').all()
        print(f'  .block 数量: {len(blocks)}')

        for i, b in enumerate(blocks):
            cls = b.get_attribute('class') or ''
            bullet = b.locator('.block-bullet').inner_text() if b.locator('.block-bullet').count() else ''
            text = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else ''
            editor = b.locator('.tiptap').inner_text() if b.locator('.tiptap').count() else ''
            print(f'  Block[{i}]: class={repr(cls)}, bullet={repr(bullet)}, block-text={repr(text[:30])}, tiptap={repr(editor[:30])}')

        browser.close()


def test_enter_splits_block():
    """Enter 在光标位置拆分 Block"""
    print('\n=== [Enter Split] Enter 拆分 Block ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # 创建第一个 Block
        create_first_block(page)

        # 点击 block-content 激活 Block
        page.locator('.block-content').first.click()
        page.wait_for_timeout(200)

        # 输入 "Hello World"
        page.locator('.block.active .tiptap').type('Hello World')
        page.wait_for_timeout(100)
        screenshot(page, '01_after_type')

        # 移动光标到中间：Home + 5 个右箭头
        page.keyboard.press('Home')
        for _ in range(5):
            page.keyboard.press('ArrowRight')
        page.wait_for_timeout(100)

        # 按 Enter 拆分
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)

        # 验证结果
        blocks = page.locator('.block').all()
        print(f'  Block 数量: {len(blocks)} (期望: 2)')

        for i, b in enumerate(blocks):
            text = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else b.locator('.tiptap').inner_text()
            active = '✅ active' if 'active' in (b.get_attribute('class') or '') else ''
            print(f'  Block[{i}]: {repr(text[:40])} {active}')

        # 断言
        assert len(blocks) == 2, f'期望 2 个 Block，实际 {len(blocks)}'

        # 验证两个 block 内容
        all_texts = []
        for b in blocks:
            t = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else b.locator('.tiptap').inner_text()
            all_texts.append(t)

        has_hello = any('Hello' in t for t in all_texts)
        has_world = any('World' in t for t in all_texts)
        assert has_hello, f'第一个 Block 应包含 "Hello"，实际: {all_texts}'
        assert has_world, f'第二个 Block 应包含 "World"，实际: {all_texts}'
        print(f'  ✅ 内容拆分正确: {all_texts}')

        # 验证新 Block 获得焦点
        active_blocks = page.locator('.block.active').all()
        print(f'  激活 Block 数量: {len(active_blocks)}')
        assert len(active_blocks) == 1, '应该有 1 个激活的 Block'

        # 验证新 Block 不显示占位符
        active_text = active_blocks[0].locator('.block-text').inner_text() if active_blocks[0].locator('.block-text').count() else active_blocks[0].locator('.tiptap').inner_text()
        print(f'  激活 Block 文本: {repr(active_text)}')
        assert 'Click to edit' not in active_text, f'不应显示 "Click to edit"，实际: {repr(active_text)}'
        assert 'Type something' not in active_text, f'不应显示 "Type something"，实际: {repr(active_text)}'
        print(f'  ✅ 新 Block 无占位符文本')

        screenshot(page, '02_after_enter_split')
        print('  ✅ Enter Split 测试通过')

        browser.close()


def test_enter_at_end_creates_empty_block():
    """Enter 在末尾创建空 Block"""
    print('\n=== [Enter Empty] Enter 在末尾创建空 Block ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        create_first_block(page)
        page.locator('.block-content').first.click()
        page.locator('.block.active .tiptap').type('Content')
        page.keyboard.press('End')
        page.keyboard.press('Enter')
        page.wait_for_timeout(400)

        blocks = page.locator('.block').all()
        assert len(blocks) == 2, f'期望 2 个 Block，实际 {len(blocks)}'
        print(f'  ✅ 创建了 2 个 Block')

        # 第二个 Block（新的）不应显示占位符
        second_text = page.locator('.block').nth(1).locator('.block-text').inner_text() \
            if page.locator('.block').nth(1).locator('.block-text').count() else page.locator('.block').nth(1).locator('.tiptap').inner_text()
        print(f'  第二个 Block 文本: {repr(second_text)}')
        assert 'Click to edit' not in second_text
        print(f'  ✅ 第二个 Block 无占位符')

        screenshot(page, '03_enter_at_end')
        print('  ✅ Enter at end 测试通过')

        browser.close()


def test_backspace_merges_blocks():
    """Backspace 在开头合并到上一个 Block"""
    print('\n=== [Backspace Merge] Backspace 合并 Block ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # 创建第一个 Block
        create_first_block(page)

        # 输入 "First"
        page.locator('.block-content').first.click()
        page.locator('.block.active .tiptap').type('First')

        # Enter 创建第二个 Block
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)

        # 输入 "Second"
        page.locator('.block.active .tiptap').type('Second')
        page.wait_for_timeout(100)

        # 点击第一个 block 使第二个失焦
        page.locator('.block').first.locator('.block-content').click()
        page.wait_for_timeout(100)

        # 重新激活第二个 Block（点击第二个 block-content）
        page.locator('.block').nth(1).locator('.block-content').click()
        page.wait_for_timeout(100)
        screenshot(page, '04_before_merge')

        # 光标移到开头
        page.keyboard.press('Home')
        page.wait_for_timeout(50)

        # Backspace 合并
        page.keyboard.press('Backspace')
        page.wait_for_timeout(400)

        blocks = page.locator('.block').all()
        print(f'  Block 数量: {len(blocks)} (期望: 1)')
        assert len(blocks) == 1, f'期望 1 个 Block，实际 {len(blocks)}'

        text = page.locator('.block-text').first.inner_text() if page.locator('.block-text').first.count() else page.locator('.block.active .tiptap').inner_text()
        print(f'  合并后内容: {repr(text)}')
        assert 'First' in text and 'Second' in text, f'内容应包含 "First" 和 "Second"，实际: {repr(text)}'
        print(f'  ✅ 合并正确: {repr(text)}')

        screenshot(page, '05_after_merge')
        print('  ✅ Backspace Merge 测试通过')

        browser.close()


def test_no_placeholder_in_empty_block():
    """空 Block 不显示任何占位符文本"""
    print('\n=== [No Placeholder] 空 Block 不显示占位符 ===')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        create_first_block(page)
        page.locator('.block-content').first.click()
        page.locator('.block.active .tiptap').type('Content')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)

        # 点击第一个 block 使第二个失去焦点
        page.locator('.block').first.locator('.block-content').click()
        page.wait_for_timeout(200)

        # 检查第二个 Block（非激活态）的 block-text
        second_text = page.locator('.block').nth(1).locator('.block-text').inner_text()
        print(f'  第二个 Block（非激活）文本: {repr(second_text)}')
        assert 'Click to edit' not in second_text, f'不应显示 "Click to edit"，实际: {repr(second_text)}'
        print(f'  ✅ 无 "Click to edit" 占位符')

        # 检查激活 Block（空）的 tiptap 内容
        active = page.locator('.block.active')
        if active.count():
            active_tiptap = active.locator('.tiptap').inner_text()
            print(f'  激活 Block tiptap 内容: {repr(active_tiptap)}')
            assert 'Type something' not in active_tiptap
            print(f'  ✅ 激活态无 "Type something" 占位符')

        screenshot(page, '06_no_placeholder')
        print('  ✅ No Placeholder 测试通过')

        browser.close()


if __name__ == '__main__':
    print('=' * 50)
    print('comind E2E 测试')
    print('=' * 50)

    # 0. 确认选择器
    test_discover_selectors()

    # 1. Enter 拆分（核心测试）
    test_enter_splits_block()

    # 2. Enter 在末尾创建空 Block
    test_enter_at_end_creates_empty_block()

    # 3. Backspace 合并
    test_backspace_merges_blocks()

    # 4. 空 Block 无占位符
    test_no_placeholder_in_empty_block()

    print('\n' + '=' * 50)
    print('✅ 全部 E2E 测试通过！')
    print('=' * 50)
