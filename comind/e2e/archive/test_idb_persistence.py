"""
调试: 刷新后 test4 和 test5 顺序颠倒
测试: 创建嵌套结构 → 拖拽 test4 → 检查 IndexedDB 保存的值 → 刷新 → 检查加载后的顺序
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def get_idb_blocks(page):
    """直接从 IndexedDB 读取 blocks 表数据"""
    return page.evaluate('''() => {
        return new Promise((resolve) => {
            const req = indexedDB.open('comind');
            req.onerror = () => resolve({ error: req.error });
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('blocks')) {
                    resolve({ error: 'no blocks store' });
                    return;
                }
                const tx = db.transaction('blocks', 'readonly');
                const store = tx.objectStore('blocks');
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => {
                    const blocks = getAllReq.result.map(b => ({
                        id: b.id.slice(0, 8),
                        content: b.content,
                        parentId: b.parentId ? b.parentId.slice(0, 8) : null,
                        left: b.left,
                    }));
                    // Sort by left for each parent group
                    const byParent = {};
                    blocks.forEach(b => {
                        const p = b.parentId || 'root';
                        if (!byParent[p]) byParent[p] = [];
                        byParent[p].push(b);
                    });
                    Object.keys(byParent).forEach(p => {
                        byParent[p].sort((a, b2) => a.left - b2.left);
                    });
                    resolve({ blocks, byParent });
                };
                getAllReq.onerror = () => resolve({ error: getAllReq.error });
            };
        });
    }''')


def get_dom_order(page):
    """获取 DOM 中的 block 顺序"""
    return page.evaluate('''() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(block => {
            const textEl = block.querySelector(':scope > .block-row > .block-content > .block-text')
                || block.querySelector(':scope > .block-row > .block-content .tiptap');
            const content = textEl ? textEl.textContent.trim() : '';
            const blockId = block.dataset.blockId;
            return { content, id: blockId ? blockId.slice(0, 8) : '?' };
        });
    }''')


def clear_and_setup(page):
    page.evaluate('''() => {
        return new Promise((resolve) => {
            indexedDB.databases().then(dbs => {
                let done = 0;
                if (dbs.length === 0) { resolve(); return; }
                dbs.forEach(db2 => {
                    const req = indexedDB.deleteDatabase(db2.name);
                    req.onsuccess = req.onerror = () => {
                        done++;
                        if (done >= dbs.length) resolve();
                    };
                });
            });
        });
    }''')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)


def setup_flat_blocks(page):
    """创建 6 个同级 block"""
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)
    for name in ['test1', 'test2', 'test3', 'test4', 'test5', 'test6']:
        page.keyboard.type(name)
        if name != 'test6':
            page.keyboard.press('Enter')
            page.wait_for_timeout(100)
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)


def setup_nested_via_js(page):
    """用 JS 创建嵌套结构"""
    setup_flat_blocks(page)
    page.evaluate('''() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        const blockStore = pinia._s.get('blocks');
        const blocks = blockStore.blocks;
        const b1 = blocks[0];
        const b2 = blocks[1];
        const b3 = blocks[2];
        const b4 = blocks[3];
        const b5 = blocks[4];
        const b6 = blocks[5];
        b2.parentId = b1.id;
        b3.parentId = b1.id;
        b4.parentId = b3.id;
        b5.parentId = b3.id;
        b6.parentId = b3.id;
        b1.left = 100;
        b2.left = 200;
        b3.left = 300;
        b4.left = 400;
        b5.left = 500;
        b6.left = 600;
        // Force reactive update
        blockStore.blocks = [...blocks];
    }''')
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)


def drag_block(page, from_name, to_name, position_ratio=0.8):
    indices = page.evaluate('''([fromName, toName]) => {
        const blocks = document.querySelectorAll('.block');
        let fromIdx = -1, toIdx = -1;
        blocks.forEach((block, i) => {
            const textEl = block.querySelector(':scope > .block-row > .block-content > .block-text')
                || block.querySelector(':scope > .block-row > .block-content .tiptap');
            const text = textEl ? textEl.textContent.trim() : '';
            if (text === fromName) fromIdx = i;
            if (text === toName) toIdx = i;
        });
        return { fromIdx, toIdx };
    }''', [from_name, to_name])

    blocks = page.locator('.block').all()
    from_block = blocks[indices['fromIdx']]
    to_block = blocks[indices['toIdx']]

    bullet = from_block.locator('.block-bullet')
    bullet_box = bullet.bounding_box()
    to_box = to_block.bounding_box()

    start_x = bullet_box['x'] + bullet_box['width'] / 2
    start_y = bullet_box['y'] + bullet_box['height'] / 2
    end_x = to_box['x'] + to_box['width'] / 2
    end_y = to_box['y'] + to_box['height'] * position_ratio

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.mouse.move(end_x, end_y, steps=10)
    page.wait_for_timeout(300)
    page.mouse.up()
    page.wait_for_timeout(800)


def wait_for_save(page, timeout_ms=2000):
    """等待 IndexedDB 保存完成（通过轮询 blocks 表）"""
    import time
    start = time.time()
    prev_data = None
    while time.time() - start < timeout_ms / 1000:
        data = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('blocks')) { resolve(null); return; }
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(getAllReq.result.map(b => ({ id: b.id.slice(0, 8), left: b.left, content: b.content })));
                    };
                };
            });
        }''')
        if data and data != prev_data:
            # Give a bit more time after data stabilizes
            prev_data = data
        time.sleep(0.1)
    return prev_data


def test_idb_persistence():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        print("\n=== 测试: 嵌套拖拽 + IndexedDB 持久化 ===\n")

        # 1. 创建嵌套结构
        print("1. 创建嵌套结构...")
        setup_nested_via_js(page)

        dom_before = get_dom_order(page)
        print(f"   DOM (拖前): {[d['content'] for d in dom_before]}")

        idb_before = get_idb_blocks(page)
        print(f"   IDB (拖前): {idb_before.get('byParent', idb_before)}")

        # 2. 拖拽 test4 到 test6 后面
        print("\n2. 拖拽 test4 → test6 (after)...")
        drag_block(page, 'test4', 'test6', 0.8)

        dom_after_drag = get_dom_order(page)
        print(f"   DOM (拖后): {[d['content'] for d in dom_after_drag]}")

        # 3. 等待 IndexedDB 保存完成
        print("\n3. 等待 IndexedDB 保存...")
        # Wait enough for debounce (300ms) + save
        page.wait_for_timeout(1000)
        idb_after_drag = get_idb_blocks(page)
        print(f"   IDB (拖后): {idb_after_drag.get('byParent', idb_after_drag)}")

        # 4. 刷新页面
        print("\n4. 刷新页面...")
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        dom_after_reload = get_dom_order(page)
        print(f"   DOM (刷新后): {[d['content'] for d in dom_after_reload]}")

        idb_after_reload = get_idb_blocks(page)
        print(f"   IDB (刷新后): {idb_after_reload.get('byParent', idb_after_reload)}")

        # 5. 分析
        print("\n=== 分析 ===")
        expected_after_drag = ['test1', 'test2', 'test3', 'test5', 'test6', 'test4']
        expected_after_reload = ['test1', 'test2', 'test3', 'test5', 'test6', 'test4']

        drag_ok = [d['content'] for d in dom_after_drag] == expected_after_drag
        reload_ok = [d['content'] for d in dom_after_reload] == expected_after_reload

        print(f"   拖拽后正确: {'✅' if drag_ok else '❌'}")
        print(f"   刷新后正确: {'✅' if reload_ok else '❌'}")

        if not reload_ok:
            print(f"\n   ⚠️ BUG: 刷新后顺序错误!")
            print(f"   期望: {expected_after_reload}")
            print(f"   实际: {[d['content'] for d in dom_after_reload]}")
            
            # Check if IDB data is correct
            if 'byParent' in idb_after_reload:
                test3_children = idb_after_reload['byParent'].get(
                    [k for k in idb_after_reload['byParent'].keys() if k and k != 'root'][0] if False else '',
                    []
                )
                for parent_key, children in idb_after_reload['byParent'].items():
                    if parent_key != 'root':
                        print(f"   IDB children of {parent_key}: {[(c['content'], c['left']) for c in children]}")

        browser.close()


if __name__ == '__main__':
    test_idb_persistence()
