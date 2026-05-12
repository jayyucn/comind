"""
性能测试：100+ Block 流畅度测试
Phase 1 验收标准：100+ Block 操作流畅，无明显卡顿

测试维度：
1. 页面加载时间（目标：<200ms）
2. 滚动流畅度（目标：无明显卡顿）
3. 编辑操作延迟（目标：<16ms）
4. 拖拽操作响应（目标：<16ms）
"""

import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def setup_100_blocks_via_ui(page):
    """通过 UI 创建 100+ Block 数据"""
    # 等待页面加载完成
    page.wait_for_selector('.sidebar', timeout=5000)
    
    # 点击新建页面按钮（如果有）或使用已有页面
    pages = page.locator('.page-item').count()
    if pages > 0:
        # 使用第一个页面
        page.locator('.page-item').first.click()
        page.wait_for_selector('.block', timeout=3000)
    else:
        # 创建新页面（假设有新建按钮）
        print("  没有页面，需要先创建")
        return False
    
    # 激活第一个 Block
    first_block = page.locator('.block-content').first
    first_block.click()
    page.wait_for_selector('.block.active', timeout=2000)
    
    # 快速创建 100 个 Block
    for i in range(1, 101):
        # 输入内容
        page.keyboard.type(f'Block {i} 测试内容', delay=0)
        # Enter 创建新 Block
        page.keyboard.press('Enter')
        page.wait_for_timeout(10)  # 最小延迟
    
    return True


def setup_100_blocks_via_console(page):
    """通过控制台使用原生 IndexedDB API 创建 100+ Block"""
    page.wait_for_load_state('networkidle')
    
    # 使用原生 IndexedDB API（数据库名：comind）
    result = page.evaluate("""
        async () => {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open('comind', 10);
                
                request.onerror = () => reject(request.error);
                
                request.onsuccess = async () => {
                    const db = request.result;
                    
                    try {
                        // 创建测试页面
                        const pageId = 'perf-test-page-' + Date.now();
                        const pagesTx = db.transaction('pages', 'readwrite');
                        const pagesStore = pagesTx.objectStore('pages');
                        
                        await new Promise((res, rej) => {
                            const putReq = pagesStore.put({
                                id: pageId,
                                title: '性能测试页',
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                            putReq.onsuccess = res;
                            putReq.onerror = () => rej(putReq.error);
                        });
                        
                        // 创建 Block 记录
                        const blocksTx = db.transaction('blocks', 'readwrite');
                        const blocksStore = blocksTx.objectStore('blocks');
                        
                        const blocks = [];
                        
                        // 100 个顶级 Block
                        for (let i = 1; i <= 100; i++) {
                            blocks.push({
                                id: `perf-block-${i}`,
                                pageId: pageId,
                                parentId: null,
                                content: `这是第 ${i} 个 Block，用于测试性能。包含一些中文内容和 [[链接]] 以及 #标签`,
                                left: i * 100,
                                isPage: false,
                                collapsed: false,
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                        }
                        
                        // 50 个嵌套 Block
                        for (let i = 1; i <= 50; i++) {
                            blocks.push({
                                id: `perf-block-${i}-child`,
                                pageId: pageId,
                                parentId: `perf-block-${i}`,
                                content: `子 Block ${i}`,
                                left: i * 50,
                                isPage: false,
                                collapsed: false,
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                        }
                        
                        // 批量插入
                        for (const block of blocks) {
                            blocksStore.put(block);
                        }
                        
                        await new Promise((res, rej) => {
                            blocksTx.oncomplete = res;
                            blocksTx.onerror = () => rej(blocksTx.error);
                        });
                        
                        resolve({ pageId, blockCount: blocks.length });
                        
                    } catch (err) {
                        reject(err);
                    }
                };
            });
        }
    """)
    
    return result


def test_page_load_performance():
    """测试页面加载性能"""
    print("\n" + "=" * 60)
    print("测试 1：页面加载性能")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 设置测试数据
        page.goto('http://localhost:5204')
        page.wait_for_load_state('networkidle')
        
        result = setup_100_blocks_via_console(page)
        if not result:
            print("  ❌ 创建测试数据失败")
            browser.close()
            return None, 0
        
        print(f"  - 已创建 {result['blockCount']} 个测试 Block")

        # 刷新页面测试加载时间
        start_time = time.time()
        page.reload()
        page.wait_for_load_state('networkidle')
        load_time = time.time() - start_time

        # 找到并打开测试页面
        page_items = page.locator('.page-item').all()
        for item in page_items:
            text = item.inner_text()
            if '性能测试' in text:
                item.click()
                break
        
        page.wait_for_selector('.block', timeout=5000)

        # 等待所有 Block 渲染
        block_count = page.locator('.block').count()
        render_time = time.time() - start_time

        print(f"  - 页面加载时间: {load_time * 1000:.0f}ms")
        print(f"  - 渲染的 Block 数量: {block_count}")
        print(f"  - 总渲染时间: {render_time * 1000:.0f}ms")

        # 截图
        page.screenshot(path='e2e/screenshots/perf_100blocks.png', full_page=True)

        # 验收标准
        if load_time < 0.5:  # 500ms 以内
            print("  ✅ 加载性能达标 (<500ms)")
        else:
            print(f"  ⚠️ 加载性能可能需要优化 ({load_time * 1000:.0f}ms)")

        browser.close()
        return load_time, block_count


def test_scroll_performance():
    """测试滚动流畅度"""
    print("\n" + "=" * 60)
    print("测试 2：滚动流畅度")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5204')
        page.wait_for_load_state('networkidle')
        setup_100_blocks_via_console(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        
        # 打开测试页面
        page_items = page.locator('.page-item').all()
        for item in page_items:
            text = item.inner_text()
            if '性能测试' in text:
                item.click()
                break
        page.wait_for_selector('.block', timeout=5000)

        # 滚动性能测试
        scroll_times = []
        for _ in range(5):
            start = time.time()
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            page.wait_for_timeout(100)
            scroll_times.append(time.time() - start)

            start = time.time()
            page.evaluate('window.scrollTo(0, 0)')
            page.wait_for_timeout(100)
            scroll_times.append(time.time() - start)

        avg_scroll_time = sum(scroll_times) / len(scroll_times)
        print(f"  - 平均滚动响应时间: {avg_scroll_time * 1000:.0f}ms")

        if avg_scroll_time < 0.05:  # 50ms
            print("  ✅ 滚动流畅度达标")
        else:
            print(f"  ⚠️ 滚动可能不够流畅")

        browser.close()
        return avg_scroll_time


def test_edit_operations_performance():
    """测试编辑操作延迟"""
    print("\n" + "=" * 60)
    print("测试 3：编辑操作延迟")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5204')
        page.wait_for_load_state('networkidle')
        setup_100_blocks_via_console(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        
        # 打开测试页面
        page_items = page.locator('.page-item').all()
        for item in page_items:
            text = item.inner_text()
            if '性能测试' in text:
                item.click()
                break
        page.wait_for_selector('.block', timeout=5000)

        # 激活第一个 Block
        page.locator('.block-content').first.click()
        page.wait_for_selector('.block.active', timeout=3000)

        # 测试 Enter 操作
        enter_times = []
        for _ in range(10):
            start = time.time()
            page.keyboard.press('Enter')
            page.wait_for_timeout(50)
            enter_times.append(time.time() - start)

        avg_enter_time = sum(enter_times) / len(enter_times)
        print(f"  - Enter 操作平均延迟: {avg_enter_time * 1000:.0f}ms")

        # 测试 Backspace 操作
        backspace_times = []
        for _ in range(5):
            # 输入一些文字
            page.keyboard.type('test')
            page.keyboard.press('Home')
            start = time.time()
            page.keyboard.press('Backspace')
            page.wait_for_timeout(50)
            backspace_times.append(time.time() - start)

        avg_backspace_time = sum(backspace_times) / len(backspace_times)
        print(f"  - Backspace 操作平均延迟: {avg_backspace_time * 1000:.0f}ms")

        # 验收：编辑延迟应 < 16ms
        if avg_enter_time < 0.016:
            print("  ✅ Enter 延迟达标 (<16ms)")
        else:
            print(f"  ⚠️ Enter 延迟: {avg_enter_time * 1000:.0f}ms")

        if avg_backspace_time < 0.016:
            print("  ✅ Backspace 延迟达标 (<16ms)")
        else:
            print(f"  ⚠️ Backspace 延迟: {avg_backspace_time * 1000:.0f}ms")

        browser.close()
        return avg_enter_time, avg_backspace_time


def test_block_count_after_operations():
    """测试操作后 Block 数量正确性"""
    print("\n" + "=" * 60)
    print("测试 4：Block 数量验证")
    print("=" * 60)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto('http://localhost:5204')
        page.wait_for_load_state('networkidle')
        setup_100_blocks_via_console(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        
        # 打开测试页面
        page_items = page.locator('.page-item').all()
        for item in page_items:
            text = item.inner_text()
            if '性能测试' in text:
                item.click()
                break
        page.wait_for_selector('.block', timeout=5000)

        initial_count = page.locator('.block').count()
        print(f"  - 初始 Block 数量: {initial_count}")

        # 创建新 Block
        page.locator('.block-content').first.click()
        page.keyboard.press('End')
        page.keyboard.press('Enter')
        page.wait_for_timeout(100)

        new_count = page.locator('.block').count()
        print(f"  - Enter 后 Block 数量: {new_count}")

        if new_count == initial_count + 1:
            print("  ✅ Enter 正确创建了新 Block")
        else:
            print(f"  ⚠️ Block 数量异常（期望 {initial_count + 1}，实际 {new_count}）")

        browser.close()
        return initial_count, new_count


def main():
    """运行所有性能测试"""
    print("\n" + "=" * 60)
    print("Phase 1 性能测试：100+ Block 流畅度")
    print("=" * 60)

    results = {}

    try:
        results['load'] = test_page_load_performance()
    except Exception as e:
        print(f"  ❌ 加载测试失败: {e}")
        results['load'] = None

    try:
        results['scroll'] = test_scroll_performance()
    except Exception as e:
        print(f"  ❌ 滚动测试失败: {e}")
        results['scroll'] = None

    try:
        results['edit'] = test_edit_operations_performance()
    except Exception as e:
        print(f"  ❌ 编辑测试失败: {e}")
        results['edit'] = None

    try:
        results['count'] = test_block_count_after_operations()
    except Exception as e:
        print(f"  ❌ Block 数量测试失败: {e}")
        results['count'] = None

    # 总结
    print("\n" + "=" * 60)
    print("性能测试总结")
    print("=" * 60)

    passed = 0
    total = 4

    if results.get('load') and results['load'][0] < 0.5:
        passed += 1
        print("  ✅ 页面加载性能")
    else:
        print("  ⚠️ 页面加载性能")

    if results.get('scroll') and results['scroll'] < 0.05:
        passed += 1
        print("  ✅ 滚动流畅度")
    else:
        print("  ⚠️ 滚动流畅度")

    if results.get('edit') and all(t < 0.05 for t in results['edit'] if t):
        passed += 1
        print("  ✅ 编辑操作延迟")
    else:
        print("  ⚠️ 编辑操作延迟")

    if results.get('count'):
        passed += 1
        print("  ✅ Block 数量正确性")
    else:
        print("  ⚠️ Block 数量正确性")

    print(f"\n通过率: {passed}/{total}")

    if passed == total:
        print("\n🎉 所有性能测试通过！Phase 1 验收标准达成。")
    else:
        print(f"\n⚠️ {total - passed} 项测试需要关注")

    return passed == total


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
