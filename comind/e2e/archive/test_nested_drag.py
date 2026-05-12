"""
测试嵌套拖拽 - 用 JS 直接操作 store 创建嵌套结构
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


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


def setup_nested_via_js(page):
    """用 JS 直接在 Pinia store 中创建嵌套结构:
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

    # 通过 Vue devtools 或全局变量访问 Pinia store 来创建嵌套结构
    # 更可靠的方式: 用页面交互 + 仔细控制每步

    # 先只创建 6 个同级 block
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)
    for name in ['test1', 'test2', 'test3', 'test4', 'test5', 'test6']:
        page.keyboard.type(name)
        if name != 'test6':
            page.keyboard.press('Enter')
            page.wait_for_timeout(100)

    page.wait_for_timeout(300)
    page.screenshot(path='e2e/screenshots/nested_01_flat.png', full_page=True)

    # 现在有 6 个同级 block。用 JS 调整 parentId 创建嵌套
    # 通过 __VUE_APP__ 或 window 访问 Pinia store
    result = page.evaluate('''() => {
        // 尝试通过 Vue app 实例访问 Pinia store
        const app = document.querySelector('#app').__vue_app__;
        if (!app) return { error: 'no vue app' };

        const pinia = app.config.globalProperties.$pinia;
        if (!pinia) return { error: 'no pinia' };

        const blockStore = pinia._s.get('blocks');
        if (!blockStore) return { error: 'no blocks store', stores: Array.from(pinia._s.keys()) };

        const blocks = blockStore.blocks;
        if (!blocks || blocks.length < 6) return { error: 'not enough blocks', count: blocks?.length };

        // 当前结构: [test1, test2, test3, test4, test5, test6] 全部 parentId=null
        // 目标:
        //   test1 (parentId=null)
        //     test2 (parentId=test1.id)
        //     test3 (parentId=test1.id)
        //       test4 (parentId=test3.id)
        //       test5 (parentId=test3.id)
        //       test6 (parentId=test3.id)

        const b1 = blocks[0]; // test1
        const b2 = blocks[1]; // test2
        const b3 = blocks[2]; // test3
        const b4 = blocks[3]; // test4
        const b5 = blocks[4]; // test5
        const b6 = blocks[5]; // test6

        // 设置嵌套关系
        b2.parentId = b1.id;   // test2 -> test1 的子
        b3.parentId = b1.id;   // test3 -> test1 的子
        b4.parentId = b3.id;   // test4 -> test3 的子
        b5.parentId = b3.id;   // test5 -> test3 的子
        b6.parentId = b3.id;   // test6 -> test3 的子

        // 重新计算 left 值
        b1.left = 100;
        b2.left = 200;         // test1 的子
        b3.left = 300;         // test1 的子
        b4.left = 400;         // test3 的子
        b5.left = 500;         // test3 的子
        b6.left = 600;         // test3 的子

        return {
            ok: true,
            ids: [b1.id.slice(0,8), b2.id.slice(0,8), b3.id.slice(0,8), b4.id.slice(0,8), b5.id.slice(0,8), b6.id.slice(0,8)],
            parents: [b1.parentId, b2.parentId, b3.parentId, b4.parentId, b5.parentId, b6.parentId]
        };
    }''')

    print(f"JS 嵌套设置结果: {result}")
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    page.wait_for_timeout(300)
    page.screenshot(path='e2e/screenshots/nested_02_nested.png', full_page=True)


def get_block_order(page):
    """获取所有 block 文本（DFS 顺序）- 用 JS 读取避免嵌套选择器问题"""
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    page.mouse.click(400, 300)
    page.wait_for_timeout(200)

    # 用 JS 读取，避免 Playwright 嵌套选择器问题
    texts = page.evaluate('''() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(block => {
            // 优先读 .block-text
            const textEl = block.querySelector(':scope > .block-row > .block-content > .block-text');
            if (textEl) return textEl.textContent.trim();
            // 其次读 tiptap 编辑器
            const editor = block.querySelector(':scope > .block-row > .block-content .tiptap');
            if (editor) return editor.textContent.trim();
            // 最后读 block-content
            const content = block.querySelector(':scope > .block-row > .block-content');
            return content ? content.textContent.trim() : '(empty)';
        });
    }''')
    
    # 过滤空字符串
    return [t if t else '(empty)' for t in texts]


def drag_block_to_block(page, from_name, to_name, position_ratio=0.8):
    """拖拽 from_name 的 bullet 到 to_name 的指定位置"""
    # 用 JS 找到正确的 block 元素（避免嵌套选择器问题）
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

    from_idx = indices['fromIdx']
    to_idx = indices['toIdx']

    if from_idx < 0 or to_idx < 0:
        print(f"  找不到: from={from_name}({from_idx}), to={to_name}({to_idx})")
        return False

    blocks = page.locator('.block').all()
    from_block = blocks[from_idx]
    to_block = blocks[to_idx]

    bullet = from_block.locator('.block-bullet')
    bullet_box = bullet.bounding_box()
    to_box = to_block.bounding_box()

    if not bullet_box or not to_box:
        print(f"  获取位置失败")
        return False

    start_x = bullet_box['x'] + bullet_box['width'] / 2
    start_y = bullet_box['y'] + bullet_box['height'] / 2
    end_x = to_box['x'] + to_box['width'] / 2
    end_y = to_box['y'] + to_box['height'] * position_ratio

    print(f"  拖拽: ({start_x:.0f},{start_y:.0f}) → ({end_x:.0f},{end_y:.0f})")

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.mouse.move(end_x, end_y, steps=10)
    page.wait_for_timeout(300)
    page.mouse.up()
    page.wait_for_timeout(800)

    return True


def test_nested_drag():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=150)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)

        success_count = 0
        fail_count = 0
        results = []

        for i in range(10):
            setup_nested_via_js(page)

            initial = get_block_order(page)
            print(f"\n#{i+1} 初始: {initial}")

            # 验证结构: test1, test2, test3, test4, test5, test6
            expected_initial = ['test1', 'test2', 'test3', 'test4', 'test5', 'test6']
            if initial != expected_initial:
                results.append(f"#{i+1}: SETUP FAIL - {initial}")
                fail_count += 1
                continue

            # 拖 test4 到 test6 后面 (after)
            ok = drag_block_to_block(page, 'test4', 'test6', 0.8)
            if not ok:
                results.append(f"#{i+1}: DRAG EXEC FAIL")
                fail_count += 1
                continue

            result = get_block_order(page)
            print(f"#{i+1} 结果: {result}")
            # 期望: test1, test2, test3, test5, test6, test4
            expected = ['test1', 'test2', 'test3', 'test5', 'test6', 'test4']

            status = "✅" if result == expected else "❌"
            if result == expected:
                success_count += 1
            else:
                fail_count += 1

            results.append(f"#{i+1}: {status} {result} (期望 {expected})")

            page.screenshot(path=f'e2e/screenshots/nested_{i+1:02d}.png', full_page=True)

        browser.close()

        print("\n" + "=" * 50)
        print(f"嵌套拖拽测试: {success_count}/10 通过, {fail_count}/10 失败")
        print("=" * 50)
        for r in results:
            print(r)


if __name__ == '__main__':
    test_nested_drag()
