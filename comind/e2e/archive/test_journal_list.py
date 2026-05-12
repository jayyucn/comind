"""Journal 列表功能 E2E 测试"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_journal_list_view():
    """测试 Journal 列表视图基本功能"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        
        # 截图初始状态
        page.screenshot(path='e2e/screenshots/01_initial.png', full_page=True)
        
        # 1. 点击 Sidebar Journal Card 打开 Journal 列表
        page.locator('.journal-hero').click()
        page.wait_for_timeout(500)
        
        # 截图 Journal 列表视图
        page.screenshot(path='e2e/screenshots/02_journal_list.png', full_page=True)
        
        # 2. 验证 Journal 列表视图显示
        assert page.locator('.journal-list-view').count() == 1
        assert page.locator('.journal-list-view .journal-title').inner_text() == '日记列表'
        
        # 3. 验证返回按钮存在
        back_btn = page.locator('.back-btn')
        assert back_btn.count() == 1
        assert '返回' in back_btn.inner_text()
        
        # 4. 验证月份选择器
        month_label = page.locator('.month-label')
        assert month_label.count() == 1
        # 格式应为 YYYY-MM
        import re
        assert re.match(r'\d{4}-\d{2}', month_label.inner_text())
        
        # 5. 验证月份切换按钮
        prev_btn = page.locator('.month-btn').first
        next_btn = page.locator('.month-btn').last
        assert prev_btn.count() == 1
        assert next_btn.count() == 1
        
        # 6. 点击返回按钮回到编辑视图
        back_btn.click()
        page.wait_for_timeout(300)
        
        # 截图返回编辑视图
        page.screenshot(path='e2e/screenshots/03_back_to_editor.png', full_page=True)
        
        # 验证回到编辑视图（显示 Block 列表）
        assert page.locator('.block-list').count() >= 1
        
        browser.close()
        print("✅ Journal 列表视图测试通过")


def test_month_navigation():
    """测试月份切换功能"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        page.goto('http://localhost:5173')
        page.wait_for_timeout(1000)
        
        # 打开 Journal 列表
        page.locator('.journal-hero').click()
        page.wait_for_timeout(500)
        
        # 获取当前月份
        month_label = page.locator('.month-label')
        initial_month = month_label.inner_text()
        
        # 点击上一月
        page.locator('.month-btn').first.click()
        page.wait_for_timeout(300)
        
        prev_month = month_label.inner_text()
        # 验证月份变化了
        assert prev_month != initial_month
        
        # 截图月份切换后
        page.screenshot(path='e2e/screenshots/04_prev_month.png', full_page=True)
        
        # 点击下一月回到当前
        page.locator('.month-btn').last.click()
        page.wait_for_timeout(300)
        
        current_month = month_label.inner_text()
        assert current_month == initial_month
        
        browser.close()
        print("✅ 月份切换测试通过")


def test_journal_entry_click():
    """测试点击日记标题导航到独立页面"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        page.goto('http://localhost:5173')
        page.wait_for_timeout(1000)
        
        # 打开 Journal 列表
        page.locator('.journal-hero').click()
        page.wait_for_timeout(500)
        
        # 查找日记条目
        entries = page.locator('.journal-entry').all()
        if len(entries) > 0:
            # 点击第一个日记的标题
            first_entry = entries[0]
            entry_header = first_entry.locator('.entry-header')
            entry_date = first_entry.locator('.entry-date').inner_text()
            
            entry_header.click()
            page.wait_for_timeout(500)
            
            # 截图导航后
            page.screenshot(path='e2e/screenshots/05_journal_page.png', full_page=True)
            
            # 验证回到编辑视图
            assert page.locator('.journal-list-view').count() == 0
            assert page.locator('.block-list').count() >= 1
            
            # 验证页面标题是日记日期
            page_title = page.locator('.page-title--display').inner_text()
            assert entry_date in page_title
        
        browser.close()
        print("✅ 日记标题点击导航测试通过")


if __name__ == '__main__':
    test_journal_list_view()
    test_month_navigation()
    test_journal_entry_click()
    print("\n🎉 所有 Journal 列表测试通过！")
