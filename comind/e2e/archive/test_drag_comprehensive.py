"""
拖拽功能全面测试套件
覆盖: 同级拖拽、嵌套拖拽、before/after 位置、阈值行为、ESC 取消、指示线、边界情况
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


# ────────────────────────────────────────────────────────────────
# 工具函数
# ────────────────────────────────────────────────────────────────

def clear_idb(page):
    """清空 IndexedDB"""
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


def setup_flat_blocks(page, names):
    """创建多个同级 block（等待 debounce 保存完成）"""
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)
    for i, name in enumerate(names):
        page.keyboard.type(name)
        if i < len(names) - 1:
            page.keyboard.press('Enter')
            page.wait_for_timeout(80)
    # 显式 blur 触发保存
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    # 等待 IndexedDB 写入完成（轮询直到数据不再变化）
    _wait_for_idb_stable(page)


def _wait_for_idb_stable(page, timeout_ms=5000):
    """等待 IndexedDB 数据稳定（连续两次读取相同则完成）"""
    import time
    start = time.time()
    prev = None
    while time.time() - start < timeout_ms / 1000:
        data = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('blocks')) { resolve(''); return; }
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(JSON.stringify(getAllReq.result.map(b => ({ c: b.content, l: b.left }))));
                    };
                };
            });
        }''')
        if data and data != prev:
            prev = data
            time.sleep(0.1)
        elif data == prev:
            break


def setup_nested_via_api(page, structure):
    """
    structure:  dict like { 'test1': ['test2', 'test3'] }
    每个 key 是 block 内容，value 是子节点列表（递归）
    """
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)

    page_id = page.evaluate('''() => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        return pinia._s.get('pages').currentPageId;
    }''')

    def build_blocks(parent_id, children, left_start=100):
        result = []
        left = left_start
        for child_content in children:
            child_id = f'block_{hash(child_content) & 0xFFFF:04x}_{left}'
            result.append({
                'content': child_content,
                'parentId': parent_id,
                'left': left,
                'id': child_id
            })
            if isinstance(child_content, dict):
                sub_children = child_content[child_content]
                sub = build_blocks(child_id, sub_children, left + 100)
                result.extend(sub)
            left += 100
        return result

    # 扁平创建: 先建所有 blocks
    blocks_def = []
    for i, name in enumerate(structure['root']):
        parent_id = None
        left = 100 + i * 100
        blocks_def.append({'content': name, 'parentId': parent_id, 'left': left, 'id': f'root_{i}_{left}'})

    # 子节点: 根据 parent_content 找 parent_id
    for name, children in structure.items():
        if name == 'root':
            continue
        if isinstance(children, list):
            for child in children:
                parent_block = next(b for b in blocks_def if b['content'] == name)
                if isinstance(child, str):
                    child_id = f'child_{hash(child) & 0xFFFF:04x}_{len(blocks_def)}'
                    blocks_def.append({
                        'content': child,
                        'parentId': parent_block['id'],
                        'left': len([b for b in blocks_def if b['parentId'] == parent_block['id']]) * 100 + parent_block['left'] + 100
                    })

    blocks_def.sort(key=lambda b: (b['parentId'] is None, b.get('left', 0)))
    result = page.evaluate('''([blocks, pageId]) => {
        return new Promise(async (resolve) => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            const storage = pinia._s.get('blocks').storage;
            for (const b of blocks) {
                await storage.saveBlock({
                    id: b.id,
                    content: b.content,
                    parentId: b.parentId,
                    pageId,
                    left: b.left,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    isPage: false,
                    title: null,
                    properties: undefined,
                    collapsed: false
                });
            }
            resolve({ ok: true, count: blocks.length });
        });
    }''', [blocks_def, page_id])

    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)


def get_dom_order(page):
    """获取 DOM 中的 block 文本顺序（DFS），过滤空 block"""
    return page.evaluate('''() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(block => {
            const textEl = block.querySelector(':scope > .block-row > .block-content > .block-text')
                || block.querySelector(':scope > .block-row > .block-content .tiptap');
            return textEl ? textEl.textContent.trim() : '';
        }).filter(t => t);  // 过滤空字符串
    }''')


def find_block_idx(page, name):
    """找到 block 在 DOM 中的索引"""
    return page.evaluate('''(name) => {
        const blocks = document.querySelectorAll('.block');
        for (let i = 0; i < blocks.length; i++) {
            const textEl = blocks[i].querySelector(':scope > .block-row > .block-content > .block-text')
                || blocks[i].querySelector(':scope > .block-row > .block-content .tiptap');
            const text = textEl ? textEl.textContent.trim() : '';
            if (text === name) return i;
        }
        return -1;
    }''', name)


def drag_block_to_idx(page, from_idx, to_idx, position_ratio=0.5):
    """拖拽 from_idx 的 bullet 到 to_idx 的指定位置"""
    blocks = page.locator('.block').all()
    if from_idx >= len(blocks) or to_idx >= len(blocks):
        return False

    # 用 :scope > .block-row > .block-bullet 避免匹配子 block 的 bullet
    bullet = blocks[from_idx].locator(':scope > .block-row > .block-bullet')
    target = blocks[to_idx]

    bullet_box = bullet.bounding_box()
    target_box = target.bounding_box()
    if not bullet_box or not target_box:
        return False

    start_x = bullet_box['x'] + bullet_box['width'] / 2
    start_y = bullet_box['y'] + bullet_box['height'] / 2
    end_x = target_box['x'] + target_box['width'] / 2
    end_y = target_box['y'] + target_box['height'] * position_ratio

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.mouse.move(end_x, end_y, steps=10)
    page.wait_for_timeout(200)
    page.mouse.up()
    page.wait_for_timeout(800)
    return True


def drag_block_to_name(page, from_name, to_name, position_ratio=0.5):
    """拖拽 from_name 到 to_name 的指定位置（ratio 0=top, 1=bottom）"""
    from_idx = find_block_idx(page, from_name)
    to_idx = find_block_idx(page, to_name)
    if from_idx < 0 or to_idx < 0:
        return False
    return drag_block_to_idx(page, from_idx, to_idx, position_ratio)


def has_drop_indicator(page, position):
    """检查是否有指定位置的 drop indicator"""
    selector = f'.drop-indicator--{position}'
    count = page.locator(selector).count()
    return count > 0


# ────────────────────────────────────────────────────────────────
# 测试用例
# ────────────────────────────────────────────────────────────────

def test_same_level_after():
    """T1: 同级拖拽 — A B C, 拖 A 到 C 后面（after）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['A', 'B', 'C'])

        initial = get_dom_order(page)
        assert initial == ['A', 'B', 'C'], f"Setup FAIL: {initial}"

        drag_block_to_name(page, 'A', 'C', 0.8)

        result = get_dom_order(page)
        expected = ['B', 'C', 'A']
        ok = result == expected
        print(f"T1 同级 after: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


def test_same_level_before():
    """T2: 同级拖拽 — A B C, 拖 C 到 A 前面（before）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['A', 'B', 'C'])

        drag_block_to_name(page, 'C', 'A', 0.2)

        result = get_dom_order(page)
        expected = ['C', 'A', 'B']
        ok = result == expected
        print(f"T2 同级 before: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


def test_same_level_between():
    """T3: 同级拖拽 — A B C, 拖 A 到 B 后面（after）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['A', 'B', 'C'])

        drag_block_to_name(page, 'A', 'B', 0.8)

        result = get_dom_order(page)
        expected = ['B', 'A', 'C']
        ok = result == expected
        print(f"T3 同级 between: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


def _create_blocks_via_store(page, blocks_def, page_id):
    """通过 Pinia store 直接创建 blocks（绕过 Tab 输入问题）"""
    return page.evaluate('''([blocks, pageId]) => {
        const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
        const blockStore = pinia._s.get('blocks');
        const now = new Date().toISOString();
        for (const b of blocks) {
            const block = {
                id: b.id,
                content: b.content,
                parentId: b.parentId,
                pageId,
                left: b.left,
                createdAt: now,
                updatedAt: now,
                isPage: false,
                title: null,
                properties: undefined,
                collapsed: false
            };
            blockStore.blocks.push(block);
        }
        return { ok: true };
    }''', [blocks_def, page_id])


def test_nested_drag_outside():
    """T4: 嵌套拖拽 — 拖子节点到父节点后面（跨级）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        page_id = page.evaluate('''() => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            return pinia._s.get('pages').currentPageId;
        }''')

        page.evaluate('''(pageId) => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            const blockStore = pinia._s.get('blocks');
            const uuid = () => crypto.randomUUID();
            const id1 = uuid().slice(0,8);
            const id2 = uuid().slice(0,8);
            const id3 = uuid().slice(0,8);
            const id4 = uuid().slice(0,8);
            const now = new Date().toISOString();
            const blocks = [
                { id: id1, content: 'root1', parentId: null, pageId, left: 100 },
                { id: id2, content: 'root2', parentId: null, pageId, left: 200 },
                { id: id3, content: 'child1', parentId: id1, pageId, left: 200 },
                { id: id4, content: 'child2', parentId: id1, pageId, left: 300 },
            ];
            for (const b of blocks) {
                blockStore.blocks.push({ ...b, createdAt: now, updatedAt: now, isPage: false, title: null, properties: undefined, collapsed: false });
            }
        }''', page_id)

        page.wait_for_timeout(500)  # wait for auto-save debounce

        initial = get_dom_order(page)
        has_root1 = 'root1' in initial
        has_child1 = 'child1' in initial
        has_child2 = 'child2' in initial

        if not (has_root1 and has_child1 and has_child2):
            print(f"T4 嵌套拖出: ❌ Setup FAIL: {initial}")
            browser.close()
            return False

        # 拖 child1 到 root2 后面 (after)
        drag_block_to_name(page, 'child1', 'root2', 0.8)

        result = get_dom_order(page)
        expected = ['root1', 'child2', 'root2', 'child1']
        ok = result == expected
        print(f"T4 嵌套拖出: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


def test_nested_drag_into():
    """T5: 嵌套拖拽 — 拖根节点 A 到 P 的子节点 C 后面（A 变成 P 的子节点）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        page_id = page.evaluate('''() => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            return pinia._s.get('pages').currentPageId;
        }''')

        page.evaluate('''(pageId) => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            const blockStore = pinia._s.get('blocks');
            const uuid = () => crypto.randomUUID();
            const id1 = uuid().slice(0,8);
            const id2 = uuid().slice(0,8);
            const id3 = uuid().slice(0,8);
            const id4 = uuid().slice(0,8);
            const now = new Date().toISOString();
            const blocks = [
                { id: id1, content: 'P', parentId: null, pageId, left: 100 },
                { id: id2, content: 'A', parentId: null, pageId, left: 200 },
                { id: id3, content: 'B', parentId: id1, pageId, left: 200 },
                { id: id4, content: 'C', parentId: id1, pageId, left: 300 },
            ];
            for (const b of blocks) {
                blockStore.blocks.push({ ...b, createdAt: now, updatedAt: now, isPage: false, title: null, properties: undefined, collapsed: false });
            }
        }''', page_id)

        page.wait_for_timeout(500)

        initial = get_dom_order(page)
        # 只要有 P, A, B, C 即可，顺序由 getBlockTree 的 DFS 决定
        has_all = all(n in initial for n in ['P', 'A', 'B', 'C'])
        if not has_all:
            print(f"T5 嵌套拖入: ❌ Setup FAIL: {initial}")
            browser.close()
            return False

        # 找 A 和 C 的索引（无论顺序如何）
        a_idx = find_block_idx(page, 'A')
        c_idx = find_block_idx(page, 'C')
        if a_idx < 0 or c_idx < 0:
            print(f"T5: 找不到 A({a_idx}) 或 C({c_idx})")
            browser.close()
            return False

        # 拖 A 到 C 后面 → A 变成 P 的子节点（在 B, C 之后）
        drag_block_to_idx(page, a_idx, c_idx, 0.8)

        result = get_dom_order(page)
        # A 拖到 C after → A 成为 P 的 child（在 B, C 之后）→ DFS: P, B, C, A
        expected = ['P', 'B', 'C', 'A']
        ok = result == expected
        print(f"T5 嵌套拖入: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


def test_repeat_10x():
    """T6: 重复测试 — 同级拖拽 A→D after, 10 次"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        ok_count = 0
        fail_count = 0
        results = []

        for i in range(10):
            clear_idb(page)
            page.reload()
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(800)

            setup_flat_blocks(page, ['A', 'B', 'C', 'D'])

            initial = get_dom_order(page)
            if initial != ['A', 'B', 'C', 'D']:
                results.append(f"#{i+1}: SETUP FAIL")
                fail_count += 1
                continue

            drag_block_to_name(page, 'A', 'D', 0.8)
            result = get_dom_order(page)
            expected = ['B', 'C', 'D', 'A']
            ok = result == expected
            if ok:
                ok_count += 1
            else:
                fail_count += 1
            results.append(f"#{i+1}: {'✅' if ok else '❌'} {result}")

        browser.close()

        print(f"T6 重复10x: {ok_count}/10 通过, {fail_count}/10 失败")
        for r in results:
            print(f"  {r}")
        return ok_count == 10


def test_threshold_click_not_drag():
    """T7: 阈值内点击 — 应该识别为 click，不触发拖拽"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['X', 'Y'])

        blocks = page.locator('.block').all()
        bullet = blocks[0].locator('.block-bullet')
        bullet_box = bullet.bounding_box()

        # 小幅移动（3px，不超过 5px 阈值）
        start_x = bullet_box['x'] + bullet_box['width'] / 2
        start_y = bullet_box['y'] + bullet_box['height'] / 2
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.wait_for_timeout(50)
        page.mouse.move(start_x + 2, start_y + 2, steps=2)
        page.wait_for_timeout(50)
        page.mouse.up()
        page.wait_for_timeout(200)

        # 应该没有 .dragging class
        dragging_count = page.locator('.block.dragging').count()

        result = get_dom_order(page)
        ok = result == ['X', 'Y'] and dragging_count == 0
        print(f"T7 阈值点击: {'✅' if ok else '❌'} (drag={dragging_count}, order={result})")
        if not ok:
            print(f"  期望: ['X', 'Y'] (不变)")
        browser.close()
        return ok


def test_esc_cancels_drag():
    """T8: ESC 取消拖拽 — 按 ESC 后 block 应回到原位"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['E', 'F'])

        initial = get_dom_order(page)

        blocks = page.locator('.block').all()
        bullet = blocks[0].locator('.block-bullet')
        target = blocks[1]
        bullet_box = bullet.bounding_box()
        target_box = target.bounding_box()

        # 开始拖拽
        page.mouse.move(bullet_box['x'] + 5, bullet_box['y'] + 10)
        page.mouse.down()
        page.wait_for_timeout(100)
        page.mouse.move(target_box['x'] + target_box['width'] / 2, target_box['y'] + target_box['height'] / 2, steps=10)
        page.wait_for_timeout(100)
        # ESC 取消
        page.keyboard.press('Escape')
        page.wait_for_timeout(100)
        page.mouse.up()
        page.wait_for_timeout(500)

        result = get_dom_order(page)
        ok = result == ['E', 'F']
        print(f"T8 ESC取消: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {initial}")
        browser.close()
        return ok


def test_self_drop_noop():
    """T9: 拖拽到自己 — 应该无操作（不崩溃）"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['S'])

        initial = get_dom_order(page)

        # 拖 S 到 S（自己）
        drag_block_to_name(page, 'S', 'S', 0.5)

        result = get_dom_order(page)
        ok = result == ['S']
        print(f"T9 拖自己: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: ['S']")
        browser.close()
        return ok


def test_descendant_drop_blocked():
    """T10: 拖入子树 — 应该被禁止"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        page_id = page.evaluate('''() => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            return pinia._s.get('pages').currentPageId;
        }''')

        page.evaluate('''(pageId) => {
            const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
            const blockStore = pinia._s.get('blocks');
            const uuid = () => crypto.randomUUID();
            const id1 = uuid().slice(0,8);
            const id2 = uuid().slice(0,8);
            const now = new Date().toISOString();
            blockStore.blocks.push(
                { id: id1, content: 'Parent', parentId: null, pageId, left: 100, createdAt: now, updatedAt: now, isPage: false, title: null, properties: undefined, collapsed: false },
                { id: id2, content: 'Child', parentId: id1, pageId, left: 200, createdAt: now, updatedAt: now, isPage: false, title: null, properties: undefined, collapsed: false }
            );
        }''', page_id)

        page.wait_for_timeout(500)

        initial = get_dom_order(page)

        # 拖 Parent 到 Child 后面 → 应该被禁止（Parent 不能变成 Child 的子）
        drag_block_to_name(page, 'Parent', 'Child', 0.8)

        result = get_dom_order(page)
        ok = result == ['Parent', 'Child']
        print(f"T10 子树禁止: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {initial}")
        browser.close()
        return ok


def test_drop_indicator_visible():
    """T11: 拖拽时 drop indicator 应可见"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=100)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['I', 'J'])

        blocks = page.locator('.block').all()
        bullet = blocks[0].locator('.block-bullet')
        target = blocks[1]
        bullet_box = bullet.bounding_box()
        target_box = target.bounding_box()

        # 开始拖拽，鼠标放在 J 的上半部分（应该显示 before 指示线）
        page.mouse.move(bullet_box['x'] + 5, bullet_box['y'] + 10)
        page.mouse.down()
        page.wait_for_timeout(100)
        page.mouse.move(target_box['x'] + target_box['width'] / 2, target_box['y'] + target_box['height'] * 0.2, steps=5)
        page.wait_for_timeout(200)

        # 检查 before indicator
        before_visible = has_drop_indicator(page, 'before')
        after_visible = has_drop_indicator(page, 'after')

        # 移到下半部分
        page.mouse.move(target_box['x'] + target_box['width'] / 2, target_box['y'] + target_box['height'] * 0.8, steps=5)
        page.wait_for_timeout(200)

        before_after = has_drop_indicator(page, 'before')
        after_after = has_drop_indicator(page, 'after')

        page.mouse.up()
        page.wait_for_timeout(200)

        ok = before_visible or after_visible
        print(f"T11 指示线: {'✅' if ok else '❌'} before(top)={before_visible} after(bot)={after_visible}")
        browser.close()
        return ok


def test_drag_after_reload():
    """T12: 拖拽后刷新，数据应持久化正确"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        clear_idb(page)
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        setup_flat_blocks(page, ['P', 'Q', 'R'])

        # 检查 IDB 保存的 Q 和 R 内容
        idb_before = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(getAllReq.result.map(b => ({ content: b.content, left: b.left })));
                    };
                };
            });
        }''')
        print(f"  IDB(拖前): {idb_before}")

        drag_block_to_name(page, 'P', 'R', 0.8)

        page.wait_for_timeout(200)

        # 拖后立即检查 IDB
        idb_after_drag = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(getAllReq.result.map(b => ({ content: b.content, left: b.left })));
                    };
                };
            });
        }''')
        print(f"  IDB(拖后): {idb_after_drag}")

        # 等待 debounce 保存完成
        page.wait_for_timeout(800)

        idb_after_wait = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(getAllReq.result.map(b => ({ content: b.content, left: b.left })));
                    };
                };
            });
        }''')
        print(f"  IDB(等待后): {idb_after_wait}")

        # 刷新
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        idb_after_reload = page.evaluate('''() => {
            return new Promise((resolve) => {
                const req = indexedDB.open('comind');
                req.onsuccess = () => {
                    const db = req.result;
                    const tx = db.transaction('blocks', 'readonly');
                    const store = tx.objectStore('blocks');
                    const getAllReq = store.getAll();
                    getAllReq.onsuccess = () => {
                        resolve(getAllReq.result.map(b => ({ content: b.content, left: b.left })));
                    };
                };
            });
        }''')
        print(f"  IDB(刷新后): {idb_after_reload}")

        result = get_dom_order(page)
        expected = ['Q', 'R', 'P']
        ok = result == expected
        print(f"T12 拖拽+刷新: {'✅' if ok else '❌'} {result}")
        if not ok:
            print(f"  期望: {expected}")
        browser.close()
        return ok


# ────────────────────────────────────────────────────────────────
# 运行所有测试
# ────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    tests = [
        test_same_level_after,
        test_same_level_before,
        test_same_level_between,
        test_nested_drag_outside,
        test_nested_drag_into,
        test_repeat_10x,
        test_threshold_click_not_drag,
        test_esc_cancels_drag,
        test_self_drop_noop,
        test_descendant_drop_blocked,
        test_drop_indicator_visible,
        test_drag_after_reload,
    ]

    results = []
    for t in tests:
        try:
            ok = t()
            results.append((t.__name__, ok))
        except Exception as e:
            print(f"{t.__name__}: ❌ 异常: {e}")
            results.append((t.__name__, False))

    print("\n" + "=" * 50)
    print("拖拽测试总结")
    print("=" * 50)
    passed = sum(1 for _, ok in results if ok)
    total = len(results)
    for name, ok in results:
        print(f"  {'✅' if ok else '❌'} {name}")
    print(f"\n通过: {passed}/{total}")
