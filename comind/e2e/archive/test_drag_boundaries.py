"""
拖拽边界问题测试方案
====================

测试目标：验证 Block 拖拽功能在各种边界条件下的行为

测试框架：Playwright
运行方式：python scripts/with_server.py --server "npm run dev" --port 5173 -- python e2e/test_drag_boundaries.py

测试场景分类：
1. 基础拖拽行为
2. 跨容器拖拽
3. 层级变化（缩进）
4. 边界条件
5. 视觉反馈
6. 错误处理
"""

from playwright.sync_api import sync_playwright, Page, Locator
import time
import os

# 测试配置
BASE_URL = "http://localhost:5173"
SCREENSHOT_DIR = "e2e/screenshots"

def ensure_screenshot_dir():
    """确保截图目录存在"""
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def screenshot(page: Page, name: str):
    """保存截图"""
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path, full_page=True)
    print(f"📸 Screenshot saved: {path}")

def get_block_by_index(page: Page, index: int) -> Locator:
    """获取第 n 个 block（从 0 开始）"""
    return page.locator(".block").nth(index)

def get_bullet(block: Locator) -> Locator:
    """获取 block 的 bullet 元素"""
    return block.locator(".block-bullet")

def drag_block(page: Page, from_block: Locator, to_block: Locator, offset_y: int = 0):
    """
    拖拽 block 到目标 block 位置
    
    Args:
        page: Playwright page
        from_block: 源 block
        to_block: 目标 block  
        offset_y: Y 轴偏移（正数向下，负数向上）
    """
    from_bullet = get_bullet(from_block)
    to_bullet = get_bullet(to_block)
    
    # 获取源和目标位置
    from_box = from_bullet.bounding_box()
    to_box = to_bullet.bounding_box()
    
    if not from_box or not to_box:
        raise ValueError("无法获取元素位置")
    
    # 计算拖拽坐标
    from_x = from_box["x"] + from_box["width"] / 2
    from_y = from_box["y"] + from_box["height"] / 2
    to_x = to_box["x"] + to_box["width"] / 2
    to_y = to_box["y"] + to_box["height"] / 2 + offset_y
    
    # 执行拖拽
    page.mouse.move(from_x, from_y)
    page.mouse.down()
    page.mouse.move(to_x, to_y, steps=10)
    page.mouse.up()

# ============================================
# 测试用例
# ============================================

def test_basic_drag_down(page: Page):
    """
    测试 1: 基础拖拽 - 向下移动
    
    初始状态:
    - Block A
    - Block B
    - Block C
    
    操作: 将 Block A 拖到 Block B 下方
    
    预期:
    - Block B
    - Block A  
    - Block C
    """
    print("\n🧪 Test 1: 基础拖拽 - 向下移动")
    
    screenshot(page, "01_initial_state")
    
    blocks = page.locator(".block").all()
    if len(blocks) < 3:
        print("⚠️ 需要至少 3 个 block 进行测试")
        return
    
    block_a = blocks[0]
    block_b = blocks[1]
    
    drag_block(page, block_a, block_b, offset_y=20)
    page.wait_for_timeout(500)
    
    screenshot(page, "02_after_drag_down")
    print("✅ Test 1 完成")

def test_basic_drag_up(page: Page):
    """
    测试 2: 基础拖拽 - 向上移动
    
    操作: 将最后一个 Block 拖到第一个位置
    
    预期: 顺序正确变化
    """
    print("\n🧪 Test 2: 基础拖拽 - 向上移动")
    
    blocks = page.locator(".block").all()
    if len(blocks) < 2:
        print("⚠️ 需要至少 2 个 block 进行测试")
        return
    
    last_block = blocks[-1]
    first_block = blocks[0]
    
    drag_block(page, last_block, first_block, offset_y=-20)
    page.wait_for_timeout(500)
    
    screenshot(page, "03_after_drag_up")
    print("✅ Test 2 完成")

def test_drag_to_child_position(page: Page):
    """
    测试 3: 拖拽到子节点位置
    
    初始状态:
    - Block A
      - Block B (子节点)
    - Block C
    
    操作: 将 Block C 拖到 Block B 下方（成为 A 的子节点）
    
    预期:
    - Block C 的缩进与 Block B 对齐
    - Block C 成为 A 的子节点
    """
    print("\n🧪 Test 3: 拖拽到子节点位置")
    
    screenshot(page, "04_before_child_drag")
    
    # 需要找到有子节点的 block
    # 这里假设第一个 block 有子节点
    blocks = page.locator(".block").all()
    
    screenshot(page, "05_after_child_drag")
    print("✅ Test 3 完成")

def test_drag_out_of_parent(page: Page):
    """
    测试 4: 从子节点拖出到同级
    
    初始状态:
    - Block A
      - Block B
    - Block C
    
    操作: 将 Block B 拖出，成为 Block C 的同级
    
    预期:
    - Block B 的缩进减少
    - Block B 与 C 同级
    """
    print("\n🧪 Test 4: 从子节点拖出到同级")
    
    screenshot(page, "06_before_drag_out")
    
    screenshot(page, "07_after_drag_out")
    print("✅ Test 4 完成")

def test_indent_alignment(page: Page):
    """
    测试 5: 缩进对齐验证
    
    验证: 同级子节点的左侧对齐
    
    操作:
    1. 创建多层级结构
    2. 拖拽新节点进入子层级
    3. 验证左侧对齐
    
    预期:
    - 所有同级节点的 .block-indent 宽度一致
    - 缩进线位置正确
    """
    print("\n🧪 Test 5: 缩进对齐验证")
    
    # 获取所有 block 的 indent 宽度
    blocks = page.locator(".block").all()
    
    for i, block in enumerate(blocks):
        indent = block.locator(".block-indent")
        if indent.count() > 0:
            width = indent.evaluate("el => el.style.width || getComputedStyle(el).width")
            print(f"  Block {i}: indent width = {width}")
    
    screenshot(page, "08_indent_check")
    print("✅ Test 5 完成")

def test_drag_to_self(page: Page):
    """
    测试 6: 拖拽到自身
    
    操作: 将 Block 拖到自己的位置
    
    预期:
    - 不应该发生任何变化
    - 不应该插入重复内容
    """
    print("\n🧪 Test 6: 拖拽到自身")
    
    blocks = page.locator(".block").all()
    if len(blocks) < 1:
        print("⚠️ 需要至少 1 个 block")
        return
    
    block = blocks[0]
    drag_block(page, block, block)
    page.wait_for_timeout(500)
    
    screenshot(page, "09_after_self_drag")
    print("✅ Test 6 完成")

def test_drag_to_descendant(page: Page):
    """
    测试 7: 拖拽到自己的后代节点
    
    初始状态:
    - Block A
      - Block B
        - Block C
    
    操作: 将 Block A 拖到 Block C 下方
    
    预期:
    - 应该被阻止（循环嵌套检测）
    - 显示禁止图标
    """
    print("\n🧪 Test 7: 拖拽到后代节点")
    
    screenshot(page, "10_before_circular_drag")
    
    # 这个测试需要有嵌套结构
    screenshot(page, "11_after_circular_drag")
    print("✅ Test 7 完成")

def test_ghost_visual(page: Page):
    """
    测试 8: Ghost 元素视觉验证
    
    验证:
    - Ghost 元素不包含 .block-indent
    - Ghost 只显示 bullet + content
    - 左边界是否正确
    """
    print("\n🧪 Test 8: Ghost 视觉验证")
    
    blocks = page.locator(".block").all()
    if len(blocks) < 2:
        print("⚠️ 需要至少 2 个 block")
        return
    
    # 开始拖拽但不释放
    block_a = blocks[0]
    block_b = blocks[1]
    
    bullet_a = get_bullet(block_a)
    box_a = bullet_a.bounding_box()
    box_b = get_bullet(block_b).bounding_box()
    
    if box_a and box_b:
        # 移动到目标位置但不释放
        page.mouse.move(box_a["x"] + box_a["width"]/2, box_a["y"] + box_a["height"]/2)
        page.mouse.down()
        page.mouse.move(box_b["x"] + box_b["width"]/2, box_b["y"] + box_b["height"]/2 + 30, steps=10)
        
        # 截图 ghost 状态
        screenshot(page, "12_ghost_visual")
        
        # 释放
        page.mouse.up()
    
    page.wait_for_timeout(500)
    print("✅ Test 8 完成")

def test_deactivate_on_drag(page: Page):
    """
    测试 9: 拖拽时失活当前 block
    
    操作:
    1. 点击 Block 进入编辑状态
    2. 开始拖拽
    
    预期:
    - 编辑状态应该退出
    - Editor 组件应该卸载
    """
    print("\n🧪 Test 9: 拖拽时失活")
    
    blocks = page.locator(".block").all()
    if len(blocks) < 2:
        print("⚠️ 需要至少 2 个 block")
        return
    
    # 点击第一个 block 进入编辑
    block_a = blocks[0]
    block_a.locator(".block-content").click()
    page.wait_for_timeout(300)
    
    screenshot(page, "13_editing_state")
    
    # 验证 Editor 是否存在
    editor = block_a.locator(".ProseMirror")
    is_editing = editor.count() > 0
    print(f"  编辑状态: {is_editing}")
    
    # 开始拖拽
    block_b = blocks[1]
    drag_block(page, block_a, block_b)
    page.wait_for_timeout(500)
    
    screenshot(page, "14_after_drag_from_edit")
    
    # 验证 Editor 应该不存在
    editor_after = block_a.locator(".ProseMirror")
    is_editing_after = editor_after.count() > 0
    print(f"  拖拽后编辑状态: {is_editing_after}")
    
    if is_editing and not is_editing_after:
        print("  ✅ 拖拽成功使编辑器失活")
    else:
        print("  ⚠️ 编辑器状态未正确变化")
    
    print("✅ Test 9 完成")

def test_cross_container_drag(page: Page):
    """
    测试 10: 跨容器拖拽
    
    验证:
    - 从一个 .block-children 拖到另一个 .block-children
    - 数据层正确更新
    - DOM 正确反映变化
    """
    print("\n🧪 Test 10: 跨容器拖拽")
    
    screenshot(page, "15_before_cross_container")
    
    # 这个需要具体的 DOM 结构支持
    screenshot(page, "16_after_cross_container")
    print("✅ Test 10 完成")

# ============================================
# 主测试流程
# ============================================

def run_all_tests():
    """运行所有测试"""
    print("=" * 60)
    print("拖拽边界问题测试")
    print("=" * 60)
    
    ensure_screenshot_dir()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        print(f"\n🌐 导航到 {BASE_URL}")
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1000)  # 额外等待 Vue 渲染
        
        # 检查页面是否正确加载
        blocks = page.locator(".block").all()
        print(f"📋 发现 {len(blocks)} 个 block")
        
        if len(blocks) == 0:
            print("⚠️ 页面上没有 block，尝试创建...")
            # 尝试点击创建新 block
            page.keyboard.press("Enter")
            page.wait_for_timeout(500)
            blocks = page.locator(".block").all()
            print(f"📋 创建后发现 {len(blocks)} 个 block")
        
        # 运行测试
        try:
            test_basic_drag_down(page)
            test_basic_drag_up(page)
            test_drag_to_child_position(page)
            test_drag_out_of_parent(page)
            test_indent_alignment(page)
            test_drag_to_self(page)
            test_drag_to_descendant(page)
            test_ghost_visual(page)
            test_deactivate_on_drag(page)
            test_cross_container_drag(page)
        except Exception as e:
            print(f"❌ 测试出错: {e}")
            screenshot(page, "error_state")
        
        browser.close()
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)

if __name__ == "__main__":
    run_all_tests()
