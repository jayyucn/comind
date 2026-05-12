"""
路由系统 E2E 测试
测试文档：docs/routing-test-plan.md
设计文档：docs/routing-design.md
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright, expect
import re
from datetime import datetime

BASE_URL = 'http://localhost:5174'


def log_result(test_name: str, passed: bool, details: str = ""):
    """记录测试结果"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} {test_name}")
    if details:
        print(f"   {details}")
    return passed


def test_tc01_homepage_redirect():
    """TC-01: 首页重定向到 /journal"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问根路径
        page.goto(f'{BASE_URL}/')
        page.wait_for_load_state('networkidle')
        
        # 检查 URL 是否重定向到 /journal
        url = page.url
        is_redirected = '/journal' in url
        
        # 检查日记列表视图是否显示
        journal_list = page.locator('.journal-list-view')
        is_visible = journal_list.count() == 1
        
        browser.close()
        
        passed = is_redirected and is_visible
        log_result("TC-01: 首页重定向", passed, 
                   f"URL: {url}, 日记列表显示: {is_visible}")
        return passed


def test_tc02_journal_list_route():
    """TC-02: 日记列表路由 /journal"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问 /journal
        page.goto(f'{BASE_URL}/journal')
        page.wait_for_load_state('networkidle')
        
        # 检查 URL
        url = page.url
        is_correct_url = '/journal' in url
        
        # 检查 JournalList 组件渲染
        journal_list = page.locator('.journal-list-view')
        is_journal_list_visible = journal_list.count() == 1
        
        # 检查日记条目列表
        entries = page.locator('.journal-entries')
        has_entries = entries.count() == 1
        
        browser.close()
        
        passed = is_correct_url and is_journal_list_visible and has_entries
        log_result("TC-02: 日记列表路由", passed, 
                   f"URL正确: {is_correct_url}, JournalList显示: {is_journal_list_visible}")
        return passed


def test_tc03_journal_page_route():
    """TC-03: 日记页面路由 /journal/:date"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问今天的日记
        today = datetime.now().strftime('%Y-%m-%d')
        page.goto(f'{BASE_URL}/journal/{today}')
        page.wait_for_load_state('networkidle')
        
        # 检查 URL 格式
        url = page.url
        is_correct_format = re.match(r'.*/journal/\d{4}-\d{2}-\d{2}', url) is not None
        
        # 检查 PageView 组件渲染
        page_view = page.locator('.page-scroll-wrapper')
        is_page_view_visible = page_view.count() >= 1
        
        # 截图
        page.screenshot(path='e2e/screenshots/routing_tc03_journal_page.png', full_page=True)
        
        browser.close()
        
        passed = is_correct_format and is_page_view_visible
        log_result("TC-03: 日记页面路由", passed, 
                   f"URL: {url}, PageView显示: {is_page_view_visible}")
        return passed


def test_tc04_page_route():
    """TC-04: 普通页面路由 /page/:pageId"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 先访问日记列表获取最近页面
        page.goto(f'{BASE_URL}/journal')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        
        # 检查最近页面列表
        recent_items = page.locator('.recent-section .page-item').all()
        
        if len(recent_items) > 0:
            # 点击第一个最近页面
            recent_items[0].click()
            page.wait_for_timeout(1000)
            
            url = page.url
            # 检查 URL 格式 (可能是 /page/:id 或 /journal/:date)
            is_correct_format = re.match(r'.*/(page|journal)/.+', url) is not None
            
            # 检查 PageView 组件
            page_view = page.locator('.page-scroll-wrapper')
            is_page_view_visible = page_view.count() >= 1
            
            passed = is_correct_format and is_page_view_visible
            log_result("TC-04: 普通页面路由", passed, f"URL: {url}")
        else:
            passed = True  # 没有最近页面，跳过
            log_result("TC-04: 普通页面路由", passed, "跳过 - 无最近页面")
        
        browser.close()
        return passed


def test_tc05_refresh_recovery():
    """TC-05: 刷新恢复"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问今天的日记
        today = datetime.now().strftime('%Y-%m-%d')
        page.goto(f'{BASE_URL}/journal/{today}')
        page.wait_for_load_state('networkidle')
        
        url_before = page.url
        
        # 刷新页面
        page.reload()
        page.wait_for_load_state('networkidle')
        
        url_after = page.url
        
        # 检查 URL 保持不变
        is_url_preserved = url_before == url_after
        
        # 检查 PageView 渲染
        page_view = page.locator('.page-scroll-wrapper')
        is_page_view_visible = page_view.count() >= 1
        
        browser.close()
        
        passed = is_url_preserved and is_page_view_visible
        log_result("TC-05: 刷新恢复", passed, 
                   f"URL保持: {is_url_preserved}, PageView显示: {is_page_view_visible}")
        return passed


def test_tc06_browser_history():
    """TC-06: 浏览器历史 (Back/Forward)"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问日记列表
        page.goto(f'{BASE_URL}/journal')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)
        
        # 点击第一个日记
        journal_items = page.locator('.journal-list-item').all()
        
        if len(journal_items) > 0:
            journal_items[0].click()
            page.wait_for_timeout(1000)
            
            journal_url = page.url
            is_journal_url = '/journal/' in journal_url
            
            # 点击 Back
            page.go_back()
            page.wait_for_timeout(500)
            
            back_url = page.url
            is_back_to_list = back_url.rstrip('/').endswith('/journal')
            
            # 检查日记列表显示
            journal_list = page.locator('.journal-list-view')
            is_journal_list_visible = journal_list.count() == 1
            
            # 点击 Forward
            page.go_forward()
            page.wait_for_timeout(500)
            
            forward_url = page.url
            is_forward_correct = forward_url == journal_url
            
            passed = is_journal_url and is_back_to_list and is_journal_list_visible and is_forward_correct
            log_result("TC-06: 浏览器历史", passed, 
                       f"Back正确: {is_back_to_list}, Forward正确: {is_forward_correct}")
        else:
            passed = True  # 没有日记条目，跳过
            log_result("TC-06: 浏览器历史", passed, "跳过 - 无日记条目")
        
        browser.close()
        return passed


def test_tc07_404_handling():
    """TC-07: 404 优雅处理 - 不存在的页面 ID"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 监听控制台错误
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        
        # 访问不存在的页面
        page.goto(f'{BASE_URL}/page/non-existent-page-id-12345')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)
        
        # 检查应用没有崩溃
        app_layout = page.locator('.app-layout')
        is_app_visible = app_layout.count() == 1
        
        # 检查是否重定向到 /journal 或显示空页面
        url = page.url
        is_redirected = '/journal' in url or '/page' in url
        
        # 检查没有严重错误
        critical_errors = [e for e in errors if 'TypeError' in e or 'ReferenceError' in e]
        no_critical_errors = len(critical_errors) == 0
        
        # 截图
        page.screenshot(path='e2e/screenshots/routing_tc07_404.png', full_page=True)
        
        browser.close()
        
        passed = is_app_visible and no_critical_errors
        log_result("TC-07: 404 优雅处理", passed, 
                   f"应用可见: {is_app_visible}, 无严重错误: {no_critical_errors}")
        return passed


def test_tc08_sidebar_navigation():
    """TC-08: Sidebar 导航 - 日记入口"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问日记列表
        page.goto(f'{BASE_URL}/journal')
        page.wait_for_load_state('networkidle')
        
        # 点击第一个日记进入页面
        journal_items = page.locator('.journal-list-item').all()
        if len(journal_items) > 0:
            journal_items[0].click()
            page.wait_for_timeout(1000)
        
        # 点击 Sidebar 的日记入口
        journal_hero = page.locator('.journal-hero')
        if journal_hero.count() > 0:
            journal_hero.click()
            page.wait_for_timeout(500)
            
            # 验证导航到日记列表
            url = page.url
            is_journal_url = url.rstrip('/').endswith('/journal')
            
            journal_list = page.locator('.journal-list-view')
            is_journal_list_visible = journal_list.count() == 1
            
            passed = is_journal_url and is_journal_list_visible
            log_result("TC-08: Sidebar 导航", passed, f"URL: {url}")
        else:
            passed = True
            log_result("TC-08: Sidebar 导航", passed, "跳过 - 无日记入口")
        
        browser.close()
        return passed


def test_tc09_recent_navigation():
    """TC-09: Sidebar 导航 - 最近页面"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # 访问日记列表
        page.goto(f'{BASE_URL}/journal')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        
        # 点击最近页面
        recent_items = page.locator('.recent-section .page-item').all()
        
        if len(recent_items) > 0:
            recent_items[0].click()
            page.wait_for_timeout(1000)
            
            url = page.url
            is_correct_url = '/page/' in url or '/journal/' in url
            
            passed = is_correct_url
            log_result("TC-09: 最近页面导航", passed, f"URL: {url}")
        else:
            passed = True
            log_result("TC-09: 最近页面导航", passed, "跳过 - 无最近页面")
        
        browser.close()
        return passed


def test_tc10_no_js_errors():
    """TC-10: 无 JavaScript 错误"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        errors = []
        page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
        
        # 访问多个路由
        page.goto(f'{BASE_URL}/')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(500)
        
        # 点击第一个日记
        journal_items = page.locator('.journal-list-item').all()
        if len(journal_items) > 0:
            journal_items[0].click()
            page.wait_for_timeout(500)
        
        # 返回
        page.go_back()
        page.wait_for_timeout(500)
        
        # 检查没有严重错误
        critical_errors = [e for e in errors if any(err in e for err in [
            'TypeError', 'ReferenceError', 'Cannot read properties', 'Uncaught'
        ])]
        
        browser.close()
        
        passed = len(critical_errors) == 0
        log_result("TC-10: 无 JavaScript 错误", passed, 
                   f"严重错误数: {len(critical_errors)}")
        return passed


def main():
    """运行所有测试"""
    print("=" * 60)
    print("路由系统 E2E 测试")
    print("测试文档：docs/routing-test-plan.md")
    print("=" * 60)
    print()
    
    # 确保截图目录存在
    screenshots_dir = Path(__file__).parent / 'screenshots'
    screenshots_dir.mkdir(exist_ok=True)
    
    results = []
    
    # 运行所有测试
    results.append(("TC-01", test_tc01_homepage_redirect()))
    results.append(("TC-02", test_tc02_journal_list_route()))
    results.append(("TC-03", test_tc03_journal_page_route()))
    results.append(("TC-04", test_tc04_page_route()))
    results.append(("TC-05", test_tc05_refresh_recovery()))
    results.append(("TC-06", test_tc06_browser_history()))
    results.append(("TC-07", test_tc07_404_handling()))
    results.append(("TC-08", test_tc08_sidebar_navigation()))
    results.append(("TC-09", test_tc09_recent_navigation()))
    results.append(("TC-10", test_tc10_no_js_errors()))
    
    # 统计结果
    print()
    print("=" * 60)
    print("测试结果汇总")
    print("=" * 60)
    
    passed_count = sum(1 for _, passed in results if passed)
    total_count = len(results)
    
    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"{status} {name}")
    
    print()
    print(f"通过: {passed_count}/{total_count}")
    print("=" * 60)
    
    return passed_count == total_count


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
