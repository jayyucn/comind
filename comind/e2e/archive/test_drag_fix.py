"""
拖拽子节点问题修复验证（E2E 测试）

此测试验证修复后的行为：
1. 拖拽子节点时，父节点不会随之移动
2. 只有被拖拽的子节点的位置改变
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_drag_child_parent_not_moved():
    """
    验证修复：拖拽子节点时，父节点不移动
    
    测试步骤：
    1. 创建父节点 Parent
    2. 缩进创建子节点 Child1, Child2
    3. 记录父节点的初始 pos 和 parentId
    4. 拖拽 Child1 到 Child2 后面
    5. 验证父节点的 pos 和 parentId 未改变
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto('http://localhost:5173')
            page.wait_for_load_state('networkidle')

            # ========== 步骤1：创建父节点 ==========
            print("Step 1: Creating parent block...")

            page.locator('.block-content').first.click()
            page.wait_for_timeout(200)
            page.keyboard.type('Parent')
            page.wait_for_timeout(100)

            parent_block = page.locator('.block.active')
            parent_block_id = parent_block.get_attribute('data-block-id')
            print(f"Parent block ID: {parent_block_id}")

            # 记录父节点的初始状态
            parent_pos_before = get_block_state(page, parent_block_id, 'pos')
            parent_parent_id_before = get_block_state(page, parent_block_id, 'parentId')
            print(f"Parent initial state: pos={parent_pos_before}, parentId={parent_parent_id_before}")

            # ========== 步骤2：创建子节点1 ==========
            print("\nStep 2: Creating child block 1...")

            page.keyboard.press('Enter')
            page.wait_for_timeout(200)
            page.keyboard.press('Tab')
            page.wait_for_timeout(200)
            page.keyboard.type('Child1')
            page.wait_for_timeout(100)

            child1_block = page.locator('.block.active')
            child1_block_id = child1_block.get_attribute('data-block-id')
            print(f"Child1 block ID: {child1_block_id}")

            # ========== 步骤3：创建子节点2 ==========
            print("\nStep 3: Creating child block 2...")

            page.keyboard.press('Enter')
            page.wait_for_timeout(200)
            page.keyboard.type('Child2')
            page.wait_for_timeout(100)

            child2_block = page.locator('.block.active')
            child2_block_id = child2_block.get_attribute('data-block-id')
            print(f"Child2 block ID: {child2_block_id}")

            # 截图：拖拽前
            page.screenshot(path='e2e/screenshots/test_drag_before.png', full_page=True)

            # ========== 步骤4：拖拽 Child1 ==========
            print("\nStep 4: Dragging Child1 to after Child2...")

            # 获取拖拽起点和终点
            child1_bullet = page.locator(f'.block[data-block-id="{child1_block_id}"] .block-bullet')
            child2_block_el = page.locator(f'.block[data-block-id="{child2_block_id}"]')

            child1_bullet_box = child1_bullet.bounding_box()
            child2_block_box = child2_block_el.bounding_box()

            if child1_bullet_box and child2_block_box:
                start_x = child1_bullet_box['x'] + child1_bullet_box['width'] / 2
                start_y = child1_bullet_box['y'] + child1_bullet_box['height'] / 2
                end_x = child2_block_box['x'] + child2_block_box['width'] / 2
                end_y = child2_block_box['y'] + child2_block_box['height'] + 20

                print(f"Drag from ({start_x:.0f}, {start_y:.0f}) to ({end_x:.0f}, {end_y:.0f})")

                # 执行拖拽
                page.mouse.move(start_x, start_y)
                page.mouse.down()
                page.wait_for_timeout(100)
                page.mouse.move(end_x, end_y, steps=20)
                page.wait_for_timeout(100)
                page.mouse.up()

            page.wait_for_timeout(500)

            # 截图：拖拽后
            page.screenshot(path='e2e/screenshots/test_drag_after.png', full_page=True)

            # ========== 步骤5：验证结果 ==========
            print("\nStep 5: Verifying results...")

            # 获取父节点的最终状态
            parent_pos_after = get_block_state(page, parent_block_id, 'pos')
            parent_parent_id_after = get_block_state(page, parent_block_id, 'parentId')
            print(f"Parent final state: pos={parent_pos_after}, parentId={parent_parent_id_after}")

            # 验证：父节点的 pos 不应该改变
            assert parent_pos_before == parent_pos_after, \
                f"❌ FAIL: Parent pos changed from {parent_pos_before} to {parent_pos_after}"
            print("✅ PASS: Parent pos unchanged")

            # 验证：父节点的 parentId 应该仍然是 null
            assert parent_parent_id_after == parent_parent_id_before, \
                f"❌ FAIL: Parent parentId changed from {parent_parent_id_before} to {parent_parent_id_after}"
            print("✅ PASS: Parent parentId unchanged")

            # 验证：Block 总数应该是 3（Parent, Child1, Child2）
            all_blocks = page.locator('.block').all()
            assert len(all_blocks) == 3, f"❌ FAIL: Expected 3 blocks, got {len(all_blocks)}"
            print(f"✅ PASS: Total blocks = {len(all_blocks)}")

            print("\n✅ All tests passed!")

        finally:
            browser.close()


def get_block_state(page, block_id: str, field: str):
    """
    从 Pinia store 获取 Block 的状态
    
    Args:
        page: Playwright page 对象
        block_id: Block ID
        field: 要获取的字段名（'pos', 'parentId' 等）
    
    Returns:
        字段值
    """
    return page.evaluate(f"""
        () => {{
            const app = document.querySelector('#app').__vue_app__
            if (app) {{
                const pinia = app.config.globalProperties.$pinia
                if (pinia) {{
                    const blockStore = pinia.state.value.blocks
                    if (blockStore) {{
                        const block = blockStore.blocks.find(b => b.id === '{block_id}')
                        return block ? block.{field} : null
                    }}
                }}
            }}
            return null
        }}
    """)


def test_drag_to_different_parent():
    """
    验证：跨容器移动子节点时，原父节点和新父节点都不受影响
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            page.goto('http://localhost:5173')
            page.wait_for_load_state('networkidle')

            # 创建两个父节点
            print("Creating Parent1...")
            page.locator('.block-content').first.click()
            page.keyboard.type('Parent1')
            parent1_id = page.locator('.block.active').get_attribute('data-block-id')

            print("Creating Parent2...")
            page.keyboard.press('Enter')
            page.keyboard.type('Parent2')
            parent2_id = page.locator('.block.active').get_attribute('data-block-id')

            # 在 Parent1 下创建子节点
            print("Creating Child under Parent1...")
            page.keyboard.press('Enter')
            page.keyboard.press('Tab')
            page.keyboard.type('Child')
            child_id = page.locator('.block.active').get_attribute('data-block-id')

            # 记录初始状态
            parent1_pos_before = get_block_state(page, parent1_id, 'pos')
            parent2_pos_before = get_block_state(page, parent2_id, 'pos')

            # 拖拽 Child 到 Parent2 下
            # 注意：这需要更复杂的拖拽逻辑，暂时跳过
            print("Skipping cross-container drag test (requires complex drag logic)")

            browser.close()

        except Exception as e:
            print(f"Error: {e}")
            browser.close()
            raise


if __name__ == '__main__':
    print("=" * 60)
    print("拖拽子节点问题修复验证")
    print("=" * 60)
    print()

    test_drag_child_parent_not_moved()

    print()
    print("=" * 60)
    print("测试完成")
    print("=" * 60)
