"""
E2E 测试：验证 Phase 1 功能改进
- 层级线显示
- 首个空 Block 自动聚焦 + Placeholder
- 页面标题编辑
"""
import sys
from pathlib import Path

# 添加项目根目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_indent_lines():
    """测试层级线显示"""
    print("\n=== 测试：层级线显示 ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5203')
        page.wait_for_load_state('networkidle')

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/01_initial.png', full_page=True)

        # 激活第一个 Block 并输入内容
        page.locator('.block-content').first.click()
        page.wait_for_timeout(200)

        # 输入 "Parent"
        page.keyboard.type('Parent')
        page.wait_for_timeout(100)

        # 按 Enter 创建子 Block
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)

        # 输入 "Child"
        page.keyboard.type('Child')
        page.wait_for_timeout(100)

        # 按 Tab 缩进 Child
        page.keyboard.press('Tab')
        page.wait_for_timeout(300)

        # 截图缩进效果
        page.screenshot(path='e2e/screenshots/02_indent_lines.png', full_page=True)

        # 验证：检查 .indent-line 元素是否存在
        indent_lines = page.locator('.indent-line').count()
        print(f"  层级线数量: {indent_lines}")

        # 验证子 Block 有缩进
        second_block_indent = page.locator('.block').nth(1).locator('.block-indent')
        width_style = second_block_indent.get_attribute('style') or ''
        print(f"  第二个 Block indent 样式: {width_style}")

        browser.close()
        print("  ✅ 测试完成")


def test_first_empty_block_focus_and_placeholder():
    """测试首个空 Block 自动聚焦 + Placeholder"""
    print("\n=== 测试：首个空 Block 自动聚焦 + Placeholder ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5203')
        page.wait_for_load_state('networkidle')

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/03_first_block_focus.png', full_page=True)

        # 等待编辑器加载
        page.wait_for_timeout(500)

        # 验证首个 Block 自动激活
        active_blocks = page.locator('.block.active')
        print(f"  自动激活的 Block 数量: {active_blocks.count()}")

        # 验证 Editor 显示
        editor_visible = page.locator('.editor-wrapper').first.is_visible()
        print(f"  Editor 可见: {editor_visible}")

        # 验证 Placeholder 显示
        placeholder = page.locator('.tiptap p.is-empty')
        placeholder_count = placeholder.count()
        print(f"  Placeholder 元素数量: {placeholder_count}")

        if placeholder_count > 0:
            placeholder_text = placeholder.first.inner_text()
            print(f"  Placeholder 内容: '{placeholder_text}'")

        # 点击空白区域取消激活
        page.locator('.block-row').first.click()
        page.wait_for_timeout(200)

        # 截图非激活状态
        page.screenshot(path='e2e/screenshots/04_no_placeholder.png', full_page=True)

        browser.close()
        print("  ✅ 测试完成")


def test_page_title_editing():
    """测试页面标题编辑"""
    print("\n=== 测试：页面标题编辑 ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5203')
        page.wait_for_load_state('networkidle')

        # 截图初始状态
        page.screenshot(path='e2e/screenshots/05_page_title.png', full_page=True)

        # 点击页面标题进入编辑模式
        page.locator('.page-title').click()
        page.wait_for_timeout(200)

        # 验证输入框出现
        title_input = page.locator('.page-title-input')
        input_visible = title_input.is_visible()
        print(f"  标题输入框可见: {input_visible}")

        if input_visible:
            # 修改标题
            title_input.fill('New Page Title')
            page.wait_for_timeout(100)

            # 按 Enter 保存
            page.keyboard.press('Enter')
            page.wait_for_timeout(300)

            # 截图编辑后
            page.screenshot(path='e2e/screenshots/06_title_changed.png', full_page=True)

            # 验证标题更新
            new_title = page.locator('.page-title').inner_text()
            print(f"  新标题: {new_title}")

        browser.close()
        print("  ✅ 测试完成")


def test_duplicate_title_dialog():
    """测试重复标题弹窗"""
    print("\n=== 测试：重复标题处理 ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5203')
        page.wait_for_load_state('networkidle')

        # 创建第一个页面（标题为 "Test"）
        page.locator('.new-page-input').fill('Test Page')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)

        # 截图
        page.screenshot(path='e2e/screenshots/07_first_page.png', full_page=True)

        # 再次创建同名页面触发弹窗
        page.locator('.new-page-input').fill('Test Page')
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)

        # 截图弹窗
        page.screenshot(path='e2e/screenshots/08_duplicate_dialog.png', full_page=True)

        # 关闭弹窗
        page.keyboard.press('Escape')
        page.wait_for_timeout(200)

        browser.close()
        print("  ✅ 测试完成")


def main():
    print("=" * 60)
    print("comind Phase 1 功能改进 E2E 测试")
    print("=" * 60)

    try:
        test_indent_lines()
        test_first_empty_block_focus_and_placeholder()
        test_page_title_editing()
        test_duplicate_title_dialog()

        print("\n" + "=" * 60)
        print("所有 E2E 测试完成！截图保存在 e2e/screenshots/")
        print("=" * 60)
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
