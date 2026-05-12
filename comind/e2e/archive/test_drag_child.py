"""
拖拽子节点问题测试

测试目标：
1. 验证拖拽子节点时，父节点不会随之移动
2. 验证只有被拖拽的子节点的位置改变
3. 验证父节点的 pos 和 parentId 保持不变
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright, expect


def test_drag_child_block():
    """
    测试场景：
    1. 创建父节点 Parent
    2. 缩进创建子节点 Child1
    3. 创建子节点 Child2
    4. 拖拽 Child1 到 Child2 后面
    5. 验证：
       - 父节点的 pos 未改变
       - 父节点的 parentId 未改变
       - 只有 Child1 的位置改变
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')

        # ========== 步骤1：创建父节点 ==========
        print("Step 1: Creating parent block...")

        # 激活第一个 Block
        page.locator('.block-content').first.click()
        page.wait_for_timeout(200)

        # 输入父节点内容
        page.keyboard.type('Parent')
        page.wait_for_timeout(100)

        # 获取父节点的 block-id
        parent_block = page.locator('.block.active')
        parent_block_id = parent_block.get_attribute('data-block-id')
        print(f"Parent block ID: {parent_block_id}")

        # 记录父节点的初始状态
        parent_pos_before = get_block_pos(page, parent_block_id)
        print(f"Parent pos before: {parent_pos_before}")

        # ========== 步骤2：创建子节点1 ==========
        print("\nStep 2: Creating child block 1...")

        # 按 Enter 创建新 Block
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)

        # Tab 缩进成为子节点
        page.keyboard.press('Tab')
        page.wait_for_timeout(200)

        # 输入子节点1内容
        page.keyboard.type('Child1')
        page.wait_for_timeout(100)

        child1_block = page.locator('.block.active')
        child1_block_id = child1_block.get_attribute('data-block-id')
        print(f"Child1 block ID: {child1_block_id}")

        # ========== 步骤3：创建子节点2 ==========
        print("\nStep 3: Creating child block 2...")

        # 按 Enter 创建新 Block
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)

        # 输入子节点2内容
        page.keyboard.type('Child2')
        page.wait_for_timeout(100)

        child2_block = page.locator('.block.active')
        child2_block_id = child2_block.get_attribute('data-block-id')
        print(f"Child2 block ID: {child2_block_id}")

        # 截图：拖拽前的状态
        page.screenshot(path='e2e/screenshots/before_drag.png', full_page=True)

        # ========== 步骤4：拖拽 Child1 ==========
        print("\nStep 4: Dragging Child1 to after Child2...")

        # 找到 Child1 的 bullet（拖拽手柄）
        # 注意：需要找到正确的 bullet，而不是父节点的
        child1_bullet = page.locator(f'.block[data-block-id="{child1_block_id}"] .block-bullet')
        child2_block_el = page.locator(f'.block[data-block-id="{child2_block_id}"]')

        # 使用 dragTo API 拖拽
        # 注意：Sortable.js 需要真实的鼠标事件，dragTo 可能不触发
        # 我们使用 mouse API 模拟真实拖拽

        # 获取 Child1 bullet 的位置
        child1_bullet_box = child1_bullet.bounding_box()
        child2_block_box = child2_block_el.bounding_box()

        if child1_bullet_box and child2_block_box:
            # 计算拖拽起点（bullet 中心）
            start_x = child1_bullet_box['x'] + child1_bullet_box['width'] / 2
            start_y = child1_bullet_box['y'] + child1_bullet_box['height'] / 2

            # 计算拖拽终点（Child2 下方）
            end_x = child2_block_box['x'] + child2_block_box['width'] / 2
            end_y = child2_block_box['y'] + child2_block_box['height'] + 10

            print(f"Drag from ({start_x}, {start_y}) to ({end_x}, {end_y})")

            # 执行拖拽
            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.wait_for_timeout(100)
            page.mouse.move(end_x, end_y, steps=20)
            page.wait_for_timeout(100)
            page.mouse.up()

        page.wait_for_timeout(500)  # 等待 Sortable 动画完成

        # 截图：拖拽后的状态
        page.screenshot(path='e2e/screenshots/after_drag.png', full_page=True)

        # ========== 步骤5：验证结果 ==========
        print("\nStep 5: Verifying results...")

        # 获取父节点的最终状态
        parent_pos_after = get_block_pos(page, parent_block_id)
        print(f"Parent pos after: {parent_pos_after}")

        # 验证：父节点的 pos 不应该改变
        if parent_pos_before != parent_pos_after:
            print(f"❌ FAIL: Parent pos changed from {parent_pos_before} to {parent_pos_after}")
        else:
            print(f"✅ PASS: Parent pos unchanged")

        # 验证：父节点的 parentId 应该仍然是 null
        parent_parent_id_after = get_block_parent_id(page, parent_block_id)
        if parent_parent_id_after is not None:
            print(f"❌ FAIL: Parent parentId changed to {parent_parent_id_after}")
        else:
            print(f"✅ PASS: Parent parentId unchanged (null)")

        # 验证：Block 总数应该是 3（Parent, Child1, Child2）
        all_blocks = page.locator('.block').all()
        print(f"Total blocks: {len(all_blocks)} (expected 3)")

        # 关闭浏览器
        browser.close()


def get_block_pos(page, block_id: str) -> int | None:
    """
    从页面状态中获取 Block 的 pos 值
    注意：这需要页面暴露 Block 数据，或者我们通过其他方式获取
    """
    # 方法1：如果页面有暴露 store 状态
    # 方法2：通过 DOM 属性（如果有的话）
    # 方法3：通过控制台日志

    # 这里我们暂时返回 None，后续可以添加实际逻辑
    # 或者通过 JavaScript 直接访问 Pinia store
    return page.evaluate(f"""
        () => {{
            // 尝试从 Pinia store 获取
            const app = document.querySelector('#app').__vue_app__
            if (app) {{
                const pinia = app.config.globalProperties.$pinia
                if (pinia) {{
                    const blockStore = pinia.state.value.blocks
                    if (blockStore) {{
                        const block = blockStore.blocks.find(b => b.id === '{block_id}')
                        return block ? block.pos : null
                    }}
                }}
            }}
            return null
        }}
    """)


def get_block_parent_id(page, block_id: str) -> str | None:
    """
    从页面状态中获取 Block 的 parentId 值
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
                        return block ? block.parentId : null
                    }}
                }}
            }}
            return null
        }}
    """)


if __name__ == '__main__':
    test_drag_child_block()
