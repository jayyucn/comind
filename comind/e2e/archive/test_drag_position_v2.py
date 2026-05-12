"""
测试拖拽位置准确性 - 修复版
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_drag_before_and_after():
    """测试 before 和 after 位置"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=400)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)

        # 创建测试数据
        page.locator('.block-content').first.click()
        page.keyboard.type('Alpha')
        page.keyboard.press('Enter')
        page.keyboard.type('Beta')
        page.keyboard.press('Enter')
        page.keyboard.type('Gamma')
        page.wait_for_timeout(500)

        page.screenshot(path='e2e/screenshots/drag_01_initial.png', full_page=True)

        def get_block_texts():
            """获取所有 block 文本"""
            blocks = page.locator('.block').all()
            texts = []
            for block in blocks:
                try:
                    text = block.locator('.block-text').inner_text(timeout=2000)
                    texts.append(text)
                except:
                    texts.append('(empty)')
            return texts

        print(f"初始顺序: {get_block_texts()}")

        # ========== 测试 1: 拖拽 Gamma 到 Beta 前面 (before) ==========
        print("\n--- 测试 1: Gamma -> before Beta ---")
        blocks = page.locator('.block').all()
        gamma_block = blocks[2]
        beta_block = blocks[1]

        bullet = gamma_block.locator('.block-bullet')
        bullet_box = bullet.bounding_box()
        beta_box = beta_block.bounding_box()

        if bullet_box and beta_box:
            start_x = bullet_box['x'] + bullet_box['width'] / 2
            start_y = bullet_box['y'] + bullet_box['height'] / 2
            # Beta 的上半部分 = before
            end_x = beta_box['x'] + 50
            end_y = beta_box['y'] + beta_box['height'] * 0.25

            print(f"拖拽: ({start_x:.0f}, {start_y:.0f}) -> ({end_x:.0f}, {end_y:.0f})")

            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.wait_for_timeout(250)
            page.mouse.move(end_x, end_y)
            page.wait_for_timeout(250)
            page.screenshot(path='e2e/screenshots/drag_02_before_dragging.png', full_page=True)
            page.mouse.up()
            page.wait_for_timeout(800)

            page.screenshot(path='e2e/screenshots/drag_03_before_result.png', full_page=True)

            result = get_block_texts()
            print(f"拖拽后顺序: {result}")
            print(f"期望: ['Alpha', 'Gamma', 'Beta']")

            if result == ['Alpha', 'Gamma', 'Beta']:
                print("✅ before 位置正确!")
            else:
                print("❌ before 位置错误!")

        # ========== 测试 2: 拖拽 Alpha 到 Gamma 后面 (after) ==========
        print("\n--- 测试 2: Alpha -> after Gamma ---")
        page.wait_for_timeout(500)
        blocks = page.locator('.block').all()

        # 找到 Alpha 和 Gamma
        alpha_idx = None
        gamma_idx = None
        for i, block in enumerate(blocks):
            text = block.locator('.block-text').inner_text(timeout=2000)
            if text == 'Alpha':
                alpha_idx = i
            elif text == 'Gamma':
                gamma_idx = i

        if alpha_idx is not None and gamma_idx is not None:
            alpha_block = blocks[alpha_idx]
            gamma_block = blocks[gamma_idx]

            bullet = alpha_block.locator('.block-bullet')
            bullet_box = bullet.bounding_box()
            gamma_box = gamma_block.bounding_box()

            if bullet_box and gamma_box:
                start_x = bullet_box['x'] + bullet_box['width'] / 2
                start_y = bullet_box['y'] + bullet_box['height'] / 2
                # Gamma 的下半部分 = after
                end_x = gamma_box['x'] + 50
                end_y = gamma_box['y'] + gamma_box['height'] * 0.75

                print(f"拖拽: ({start_x:.0f}, {start_y:.0f}) -> ({end_x:.0f}, {end_y:.0f})")

                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.wait_for_timeout(250)
                page.mouse.move(end_x, end_y)
                page.wait_for_timeout(250)
                page.screenshot(path='e2e/screenshots/drag_04_after_dragging.png', full_page=True)
                page.mouse.up()
                page.wait_for_timeout(800)

                page.screenshot(path='e2e/screenshots/drag_05_after_result.png', full_page=True)

                result = get_block_texts()
                print(f"拖拽后顺序: {result}")
                print(f"期望: ['Gamma', 'Alpha', 'Beta'] 或 ['Beta', 'Gamma', 'Alpha'] (取决于当前顺序)")

        browser.close()


if __name__ == '__main__':
    test_drag_before_and_after()
