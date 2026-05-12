"""
测试: 用 JS 直接创建正确结构（绕过 Tab 输入问题），验证刷新后顺序
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
                        parentId: b.parentId ? b.parentId.slice(0, 8) : 'root',
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


def setup_correct_via_api(page):
    """用 JS 直接调用 storage.saveBlock 创建正确结构（绕过 Tab 输入问题）"""
    # 先获取 pageId
    page_id = page.evaluate('''() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        const pageStore = pinia._s.get('pages');
        return pageStore.currentPageId;
    }''')
    
    # 清除 IDB
    clear_idb(page)
    
    # 刷新页面
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)

    print(f"Page ID: {page_id}")

    # 用 storage API 直接创建 blocks
    result = page.evaluate('''(pageId) => {
        return new Promise(async (resolve) => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            const storage = pinia._s.get('blocks').storage;

            // 生成 UUID
            const uuid = () => crypto.randomUUID();

            const id1 = uuid(), id2 = uuid(), id3 = uuid(), id4 = uuid(), id5 = uuid(), id6 = uuid();

            // 创建 blocks
            const blocks = [
                { id: id1, content: 'test1', parentId: null, pageId, left: 100 },
                { id: id2, content: 'test2', parentId: id1, pageId, left: 200 },
                { id: id3, content: 'test3', parentId: id1, pageId, left: 300 },
                { id: id4, content: 'test4', parentId: id3, pageId, left: 400 },
                { id: id5, content: 'test5', parentId: id3, pageId, left: 500 },
                { id: id6, content: 'test6', parentId: id3, pageId, left: 600 },
            ];

            for (const b of blocks) {
                await storage.saveBlock({
                    ...b,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    isPage: false,
                    title: null,
                    properties: undefined,
                    collapsed: false
                });
            }

            resolve({ ok: true, ids: [id1.slice(0,8), id2.slice(0,8), id3.slice(0,8)] });
        });
    }''', page_id)

    print(f"创建结果: {result}")
    return page_id


def test_getblocktree_fix():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        print("\n=== 测试: getBlockTree 修复 ===\n")

        page_id = setup_correct_via_api(page)

        # 刷新加载新数据
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        dom = get_dom_order(page)
        print(f"刷新后 DOM: {dom}")

        idb = get_idb_blocks(page)
        print(f"刷新后 IDB:")
        for b in idb:
            print(f"  {b['content']:8s} left={b['left']:4d}  parentId={b['parentId']}")

        page.screenshot(path='e2e/screenshots/getblocktree_fix.png', full_page=True)

        expected = ['test1', 'test2', 'test3', 'test4', 'test5', 'test6']
        if dom == expected:
            print(f"\n✅ 顺序正确: {dom}")
        else:
            print(f"\n❌ 顺序错误!")
            print(f"   期望: {expected}")
            print(f"   实际: {dom}")

        browser.close()


if __name__ == '__main__':
    test_getblocktree_fix()
