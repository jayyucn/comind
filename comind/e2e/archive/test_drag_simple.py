"""
简化拖拽测试 - 验证拖拽位置问题
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_drag_simple():
    """简单拖拽测试"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/01_initial.png', full_page=True)

        # 创建测试数据
        page.locator('.block-content').first.click()
        page.keyboard.type('First')
        page.keyboard.press('Enter')
        page.keyboard.type('Second')
        page.keyboard.press('Enter')
        page.keyboard.type('Third')
        page.wait_for_timeout(300)

        page.screenshot(path='e2e/screenshots/02_after_create.png', full_page=True)

        # 获取所有 blocks
        blocks = page.locator('.block').all()
        print(f"Block 数量: {len(blocks)}")

        if len(blocks) >= 3:
            # 拖拽第一个 block 的 bullet
            first_block = blocks[0]
            second_block = blocks[1]

            bullet = first_block.locator('.block-bullet')

            # 获取位置
            bullet_box = bullet.bounding_box()
            second_box = second_block.bounding_box()

            print(f"Bullet box: {bullet_box}")
            print(f"Second block box: {second_box}")

            if bullet_box and second_box:
                # 从 bullet 中心开始
                start_x = bullet_box['x'] + bullet_box['width'] / 2
                start_y = bullet_box['y'] + bullet_box['height'] / 2

                # 拖到第二个 block 的下半部分（after）
                end_x = second_box['x'] + 50  # 稍微偏右一点
                end_y = second_box['y'] + second_box['height'] * 0.75

                print(f"拖拽: ({start_x}, {start_y}) -> ({end_x}, {end_y})")

                # 执行拖拽
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.wait_for_timeout(200)  # 等待超过 5px 阈值

                # 移动
                page.mouse.move(end_x, end_y)
                page.wait_for_timeout(200)

                page.screenshot(path='e2e/screenshots/03_during_drag.png', full_page=True)

                # 释放
                page.mouse.up()
                page.wait_for_timeout(500)

                page.screenshot(path='e2e/screenshots/04_after_drop.png', full_page=True)

                # 检查结果
                blocks_after = page.locator('.block').all()
                print(f"\n拖拽后 Block 数量: {len(blocks_after)}")

                for i, block in enumerate(blocks_after):
                    try:
                        text = block.locator('.block-text').inner_text()
                        print(f"  Block {i}: {text}")
                    except:
                        print(f"  Block {i}: (无法获取文本)")

        browser.close()


if __name__ == '__main__':
    test_drag_simple()
