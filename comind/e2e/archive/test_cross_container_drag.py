"""
跨容器拖拽黑线问题测试（E2E）

此测试复现问题：
1. 创建两个父节点 Parent1, Parent2
2. 在 Parent1 下创建子节点 Child
3. 跨容器拖拽 Child 到 Parent2 下
4. 观察拖拽过程中是否有横向黑线闪烁
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright
import time


def test_cross_container_drag():
    """
    复现跨容器拖拽黑线问题
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=500)  # 慢速模式，便于观察
        page = browser.new_page()

        try:
            page.goto('http://localhost:5173')
            page.wait_for_load_state('networkidle')

            # ========== 步骤1：创建 Parent1 ==========
            print("Step 1: Creating Parent1...")

            page.locator('.block-content').first.click()
            page.wait_for_timeout(300)
            page.keyboard.type('Parent1')
            page.wait_for_timeout(200)

            parent1_block = page.locator('.block.active')
            parent1_id = parent1_block.get_attribute('data-block-id')
            print(f"Parent1 ID: {parent1_id}")

            # ========== 步骤2：创建 Parent2 ==========
            print("\nStep 2: Creating Parent2...")

            page.keyboard.press('Enter')
            page.wait_for_timeout(300)
            page.keyboard.type('Parent2')
            page.wait_for_timeout(200)

            parent2_block = page.locator('.block.active')
            parent2_id = parent2_block.get_attribute('data-block-id')
            print(f"Parent2 ID: {parent2_id}")

            # 回到 Parent1（向上移动）
            page.keyboard.press('ArrowUp')
            page.wait_for_timeout(200)

            # ========== 步骤3：在 Parent1 下创建 Child ==========
            print("\nStep 3: Creating Child under Parent1...")

            page.keyboard.press('Enter')
            page.wait_for_timeout(300)
            page.keyboard.press('Tab')
            page.wait_for_timeout(300)
            page.keyboard.type('Child')
            page.wait_for_timeout(200)

            child_block = page.locator('.block.active')
            child_id = child_block.get_attribute('data-block-id')
            print(f"Child ID: {child_id}")

            # 截图：拖拽前
            page.screenshot(path='e2e/screenshots/cross_drag_before.png', full_page=True)

            # ========== 步骤4：跨容器拖拽 Child 到 Parent2 下 ==========
            print("\nStep 4: Cross-container dragging Child to Parent2...")

            # 获取拖拽起点和终点
            child_bullet = page.locator(f'.block[data-block-id="{child_id}"] .block-bullet')
            parent2_block_el = page.locator(f'.block[data-block-id="{parent2_id}"]')

            child_bullet_box = child_bullet.bounding_box()
            parent2_block_box = parent2_block_el.bounding_box()

            if child_bullet_box and parent2_block_box:
                start_x = child_bullet_box['x'] + child_bullet_box['width'] / 2
                start_y = child_bullet_box['y'] + child_bullet_box['height'] / 2
                end_x = parent2_block_box['x'] + parent2_block_box['width'] / 2
                end_y = parent2_block_box['y'] + parent2_block_box['height'] + 30

                print(f"Drag from ({start_x:.0f}, {start_y:.0f}) to ({end_x:.0f}, {end_y:.0f})")

                # 执行拖拽（慢速，分多步）
                page.mouse.move(start_x, start_y)
                page.wait_for_timeout(100)
                page.mouse.down()
                page.wait_for_timeout(200)

                # 缓慢移动，观察黑线
                for i in range(10):
                    mid_x = start_x + (end_x - start_x) * i / 10
                    mid_y = start_y + (end_y - start_y) * i / 10
                    page.mouse.move(mid_x, mid_y)
                    page.wait_for_timeout(100)
                    page.screenshot(path=f'e2e/screenshots/cross_drag_step_{i}.png', full_page=True)

                page.mouse.move(end_x, end_y)
                page.wait_for_timeout(200)
                page.mouse.up()

            page.wait_for_timeout(500)

            # 截图：拖拽后
            page.screenshot(path='e2e/screenshots/cross_drag_after.png', full_page=True)

            print("\n✅ Test completed. Check screenshots for horizontal black line.")
            print("Press Ctrl+C to close browser...")

            # 保持浏览器打开，便于用户观察
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass

        finally:
            browser.close()


def inspect_dom_during_drag():
    """
    检查拖拽过程中的 DOM 结构
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        try:
            page.goto('http://localhost:5173')
            page.wait_for_load_state('networkidle')

            # 创建简单结构
            page.locator('.block-content').first.click()
            page.keyboard.type('Parent1')
            page.keyboard.press('Enter')
            page.keyboard.type('Parent2')

            # 添加子节点
            page.keyboard.press('ArrowUp')
            page.keyboard.press('Enter')
            page.keyboard.press('Tab')
            page.keyboard.type('Child')

            # 获取元素
            child_bullet = page.locator('.block-bullet').nth(2)  # 第3个 bullet（Child 的）
            parent2 = page.locator('.block').nth(1)  # Parent2

            # 开始拖拽
            child_bullet_box = child_bullet.bounding_box()
            parent2_box = parent2.bounding_box()

            if child_bullet_box and parent2_box:
                start_x = child_bullet_box['x'] + child_bullet_box['width'] / 2
                start_y = child_bullet_box['y'] + child_bullet_box['height'] / 2

                page.mouse.move(start_x, start_y)
                page.mouse.down()

                # 检查 DOM
                print("\n=== DOM during drag ===")
                dom_content = page.evaluate("""
                    () => {
                        const children = document.querySelectorAll('.block-children');
                        let result = [];
                        children.forEach(el => {
                            result.push({
                                parentId: el.dataset.parentId,
                                childCount: el.children.length,
                                children: Array.from(el.children).map(c => ({
                                    tag: c.tagName,
                                    blockId: c.dataset.blockId,
                                    className: c.className,
                                    hasBefore: window.getComputedStyle(c, '::before').content !== 'none'
                                }))
                            });
                        });
                        return result;
                    }
                """)

                import json
                print(json.dumps(dom_content, indent=2))

                page.mouse.up()

        finally:
            browser.close()


if __name__ == '__main__':
    print("=" * 60)
    print("跨容器拖拽黑线问题测试")
    print("=" * 60)
    print()

    # 运行测试
    test_cross_container_drag()

    # 或者检查 DOM
    # inspect_dom_during_drag()
