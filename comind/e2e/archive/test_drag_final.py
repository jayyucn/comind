"""
验证拖拽位置 - 最终测试
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_final():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        # 创建 3 个同级 block
        page.locator('.block-content').first.click()
        page.keyboard.type('Block-1')
        page.keyboard.press('Enter')
        page.keyboard.type('Block-2')
        page.keyboard.press('Enter')
        page.keyboard.type('Block-3')
        page.wait_for_timeout(400)

        page.screenshot(path='e2e/screenshots/final_01.png', full_page=True)

        # 获取初始顺序
        def get_order():
            return page.locator('.block-text').all_inner_texts()

        initial = get_order()
        print(f"初始: {initial}")

        # 拖拽 Block-1 到 Block-3 后面
        blocks = page.locator('.block').all()
        bullet = blocks[0].locator('.block-bullet')
        bullet_box = bullet.bounding_box()
        block3_box = blocks[2].bounding_box()

        if bullet_box and block3_box:
            start_x = bullet_box['x'] + bullet_box['width'] / 2
            start_y = bullet_box['y'] + bullet_box['height'] / 2
            end_x = block3_box['x'] + block3_box['width'] / 2
            end_y = block3_box['y'] + block3_box['height'] * 0.75

            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.wait_for_timeout(150)
            page.mouse.move(end_x, end_y)
            page.wait_for_timeout(150)
            page.screenshot(path='e2e/screenshots/final_02_dragging.png', full_page=True)
            page.mouse.up()
            page.wait_for_timeout(1000)  # 增加等待

            page.screenshot(path='e2e/screenshots/final_03_result.png', full_page=True)

            result = get_order()
            print(f"结果: {result}")
            print(f"期望: ['Block-2', 'Block-3', 'Block-1']")

            if result == ['Block-2', 'Block-3', 'Block-1']:
                print("✅ 测试通过!")
            else:
                print("❌ 测试失败!")

        browser.close()


if __name__ == '__main__':
    test_final()
