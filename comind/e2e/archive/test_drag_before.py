"""
测试拖拽 before 位置
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_drag_before():
    """测试拖拽到 before 位置"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/before_01_initial.png', full_page=True)

        # 创建测试数据
        page.locator('.block-content').first.click()
        page.keyboard.type('First')
        page.keyboard.press('Enter')
        page.keyboard.type('Second')
        page.keyboard.press('Enter')
        page.keyboard.type('Third')
        page.wait_for_timeout(300)

        page.screenshot(path='e2e/screenshots/before_02_created.png', full_page=True)

        # 获取所有 blocks
        blocks = page.locator('.block').all()
        print(f"初始顺序:")
        for i, block in enumerate(blocks):
            text = block.locator('.block-text').inner_text()
            print(f"  {i}: {text}")

        # 拖拽 Third 到 Second 前面 (before)
        third_block = blocks[2]
        second_block = blocks[1]

        bullet = third_block.locator('.block-bullet')
        bullet_box = bullet.bounding_box()
        second_box = second_block.bounding_box()

        if bullet_box and second_box:
            start_x = bullet_box['x'] + bullet_box['width'] / 2
            start_y = bullet_box['y'] + bullet_box['height'] / 2

            # 拖到 Second 的上半部分 = before
            end_x = second_box['x'] + 50
            end_y = second_box['y'] + second_box['height'] * 0.25

            print(f"\n拖拽 Third 到 Second 的 before 位置")
            print(f"从 ({start_x}, {start_y}) 到 ({end_x}, {end_y})")

            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.wait_for_timeout(200)
            page.mouse.move(end_x, end_y)
            page.wait_for_timeout(200)
            page.screenshot(path='e2e/screenshots/before_03_dragging.png', full_page=True)
            page.mouse.up()
            page.wait_for_timeout(500)

            page.screenshot(path='e2e/screenshots/before_04_result.png', full_page=True)

            # 检查结果
            blocks_after = page.locator('.block').all()
            print(f"\n拖拽后顺序:")
            for i, block in enumerate(blocks_after):
                try:
                    text = block.locator('.block-text').inner_text()
                    print(f"  {i}: {text}")
                except:
                    print(f"  {i}: (error)")

            # 验证：期望 First, Third, Second
            texts = [b.locator('.block-text').inner_text() for b in blocks_after]
            print(f"\n期望: ['First', 'Third', 'Second']")
            print(f"实际: {texts}")

        browser.close()


if __name__ == '__main__':
    test_drag_before()
