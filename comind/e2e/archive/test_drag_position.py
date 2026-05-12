"""
拖拽位置测试 - 验证拖拽放置位置是否正确
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_drag_position_accuracy():
    """测试拖拽放置位置是否准确"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)  # 非 headless 便于调试
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/drag_initial.png', full_page=True)

        # 获取所有 block
        blocks = page.locator('.block').all()
        print(f"初始 Block 数量: {len(blocks)}")

        # 获取每个 block 的文本
        for i, block in enumerate(blocks):
            text = block.locator('.block-text').inner_text()
            print(f"Block {i}: {text[:30] if text else '(empty)'}")

        # 测试：拖拽第一个 block 到第二个 block 后面
        if len(blocks) >= 2:
            first_block = blocks[0]
            second_block = blocks[1]

            # 获取 bullet 位置
            bullet = first_block.locator('.block-bullet')
            bullet_box = bullet.bounding_box()
            print(f"Bullet 位置: {bullet_box}")

            # 获取第二个 block 的位置（用于计算放置目标）
            second_box = second_block.bounding_box()
            print(f"第二个 Block 位置: {second_box}")

            # 模拟拖拽：从 bullet 按下，拖到第二个 block 的下半部分
            if bullet_box and second_box:
                start_x = bullet_box['x'] + bullet_box['width'] / 2
                start_y = bullet_box['y'] + bullet_box['height'] / 2

                # 拖到第二个 block 的下半部分（应该触发 'after'）
                end_x = second_box['x'] + second_box['width'] / 2
                end_y = second_box['y'] + second_box['height'] * 0.75

                print(f"拖拽: ({start_x}, {start_y}) -> ({end_x}, {end_y})")

                # 执行拖拽
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.wait_for_timeout(100)  # 等待阈值判定

                # 移动过程中截图看指示线
                page.mouse.move(end_x, end_y)
                page.wait_for_timeout(100)
                page.screenshot(path='e2e/screenshots/dragging.png', full_page=True)

                # 释放
                page.mouse.up()
                page.wait_for_timeout(500)

                # 截图结果
                page.screenshot(path='e2e/screenshots/drag_result.png', full_page=True)

                # 验证位置变化
                blocks_after = page.locator('.block').all()
                print(f"\n拖拽后 Block 数量: {len(blocks_after)}")

                for i, block in enumerate(blocks_after):
                    text = block.locator('.block-text').inner_text()
                    print(f"Block {i}: {text[:30] if text else '(empty)'}")

        browser.close()


def test_drag_before_after():
    """测试 before 和 after 位置检测"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)

        # 先创建几个测试 block
        page.locator('.block-content').first.click()
        page.keyboard.type('Block A')
        page.keyboard.press('Enter')
        page.keyboard.type('Block B')
        page.keyboard.press('Enter')
        page.keyboard.type('Block C')
        page.wait_for_timeout(200)

        page.screenshot(path='e2e/screenshots/drag_test_setup.png', full_page=True)

        # 获取 Block A 的 bullet
        blocks = page.locator('.block').all()
        block_a = None
        block_b = None
        for block in blocks:
            text = block.locator('.block-text').inner_text()
            if 'Block A' in text:
                block_a = block
            elif 'Block B' in text:
                block_b = block

        if block_a and block_b:
            # 拖拽 A 到 B 的上面一半（应该 before B）
            bullet = block_a.locator('.block-bullet')
            bullet_box = bullet.bounding_box()
            b_box = block_b.bounding_box()

            if bullet_box and b_box:
                start_x = bullet_box['x'] + bullet_box['width'] / 2
                start_y = bullet_box['y'] + bullet_box['height'] / 2

                # B 的上半部分 = before
                end_x = b_box['x'] + b_box['width'] / 2
                end_y = b_box['y'] + b_box['height'] * 0.25

                print(f"拖拽 A 到 B 的 before 位置: ({start_x}, {start_y}) -> ({end_x}, {end_y})")

                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.wait_for_timeout(150)
                page.mouse.move(end_x, end_y)
                page.wait_for_timeout(150)
                page.screenshot(path='e2e/screenshots/drag_before.png', full_page=True)
                page.mouse.up()
                page.wait_for_timeout(500)

                page.screenshot(path='e2e/screenshots/drag_before_result.png', full_page=True)

        browser.close()


if __name__ == '__main__':
    print("=" * 50)
    print("测试 1: 拖拽位置准确性")
    print("=" * 50)
    test_drag_position_accuracy()

    print("\n" + "=" * 50)
    print("测试 2: Before/After 位置检测")
    print("=" * 50)
    test_drag_before_after()
