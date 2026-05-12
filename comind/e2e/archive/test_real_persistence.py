"""
测试真实操作: 用 Tab 键创建嵌套结构，然后刷新，检查顺序是否正确
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def clear_idb(page):
    page.evaluate('''() => {
        return new Promise((resolve) => {
            indexedDB.databases().then(dbs => {
                let done = 0;
                if (dbs.length === 0) { resolve(); return; }
                dbs.forEach(db => {
                    const req = indexedDB.deleteDatabase(db.name);
                    req.onsuccess = req.onerror = () => {
                        done++;
                        if (done >= dbs.length) resolve();
                    };
                });
            });
        });
    }''')


def get_idb_blocks(page):
    return page.evaluate('''() => {
        return new Promise((resolve) => {
            const req = indexedDB.open('comind');
            req.onerror = () => resolve({ error: 'open failed' });
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('blocks')) { resolve({ error: 'no blocks store' }); return; }
                const tx = db.transaction('blocks', 'readonly');
                const store = tx.objectStore('blocks');
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => {
                    const blocks = getAllReq.result.map(b => ({
                        content: b.content,
                        parentId: b.parentId ? b.parentId.slice(0, 8) : null,
                        left: b.left,
                    }));
                    resolve(blocks);
                };
            };
        });
    }''')


def get_dom_order(page):
    return page.evaluate('''() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(block => {
            const textEl = block.querySelector(':scope > .block-row > .block-content > .block-text')
                || block.querySelector(':scope > .block-row > .block-content .tiptap');
            return textEl ? textEl.textContent.trim() : '(empty)';
        });
    }''')


def setup_nested_real(page):
    """用真实 Tab 键创建嵌套结构:
    test1
      test2
      test3
        test4
        test5
        test6
    """
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)

    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # test1
    page.keyboard.type('test1')
    page.wait_for_timeout(100)

    # test2: Enter → Tab (成为 test1 子)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('test2')
    page.wait_for_timeout(100)
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)

    # test3: Enter → Tab (成为 test2 子)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('test3')
    page.wait_for_timeout(100)
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)

    # test4: Enter → Tab (成为 test3 子)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('test4')
    page.wait_for_timeout(100)
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)

    # test5: Enter (test3 子)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('test5')
    page.wait_for_timeout(300)

    # test6: Enter (test3 子)
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('test6')
    page.wait_for_timeout(500)

    # 等待 debounce 保存
    page.keyboard.press('Escape')
    page.wait_for_timeout(1000)

    page.screenshot(path='e2e/screenshots/real_setup.png', full_page=True)


def test_real_persistence():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        print("\n=== 测试: 真实 Tab 操作 + 刷新持久化 ===\n")

        setup_nested_real(page)

        dom_before = get_dom_order(page)
        print(f"创建后 DOM: {dom_before}")

        idb_before = get_idb_blocks(page)
        print(f"创建后 IDB:")
        for b in sorted(idb_before, key=lambda x: x['left']):
            print(f"  {b['content']:8s} left={b['left']:4d}  parentId={b['parentId']}")

        # 刷新
        print("\n刷新页面...")
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        dom_after = get_dom_order(page)
        print(f"刷新后 DOM: {dom_after}")

        idb_after = get_idb_blocks(page)
        print(f"刷新后 IDB:")
        for b in sorted(idb_after, key=lambda x: x['left']):
            print(f"  {b['content']:8s} left={b['left']:4d}  parentId={b['parentId']}")

        page.screenshot(path='e2e/screenshots/real_after_reload.png', full_page=True)

        # 检查
        if dom_before == dom_after:
            print("\n✅ 刷新前后顺序一致!")
        else:
            print(f"\n❌ 刷新后顺序变了!")
            print(f"   前: {dom_before}")
            print(f"   后: {dom_after}")

        browser.close()


if __name__ == '__main__':
    test_real_persistence()
