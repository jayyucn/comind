"""
测试同级拖拽: A B C D, 拖 A 到 D 后面, 重复 10 次
清空 IndexedDB
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def clear_and_setup(page):
    """清空 IndexedDB 并重建"""
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
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(800)
    
    # 确认空白
    page.wait_for_timeout(300)
    
    # 创建 A B C D
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)
    page.keyboard.type('A')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('B')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('C')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    page.keyboard.type('D')
    page.wait_for_timeout(300)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)


def get_block_order(page):
    """获取所有 block 文本顺序"""
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    
    blocks = page.locator('.block').all()
    texts = []
    for block in blocks:
        try:
            content_el = block.locator('.block-content')
            text = content_el.inner_text(timeout=2000)
            texts.append(text.strip() if text.strip() else '(empty)')
        except:
            texts.append('(err)')
    return texts


def drag_block(page, from_idx, to_idx, position_ratio=0.8):
    """拖拽"""
    blocks = page.locator('.block').all()
    if from_idx >= len(blocks) or to_idx >= len(blocks):
        return False
    
    from_block = blocks[from_idx]
    to_block = blocks[to_idx]
    
    bullet = from_block.locator('.block-bullet')
    bullet_box = bullet.bounding_box()
    to_box = to_block.bounding_box()
    
    if not bullet_box or not to_box:
        return False
    
    start_x = bullet_box['x'] + bullet_box['width'] / 2
    start_y = bullet_box['y'] + bullet_box['height'] / 2
    end_x = to_box['x'] + to_box['width'] / 2
    end_y = to_box['y'] + to_box['height'] * position_ratio
    
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.wait_for_timeout(200)
    page.mouse.move(end_x, end_y, steps=10)
    page.wait_for_timeout(200)
    page.mouse.up()
    page.wait_for_timeout(800)
    
    return True


def test_repeat_drag():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=200)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(800)
        
        success_count = 0
        fail_count = 0
        results = []
        
        for i in range(10):
            clear_and_setup(page)
            
            initial = get_block_order(page)
            if len(initial) != 4 or initial != ['A', 'B', 'C', 'D']:
                results.append(f"#{i+1}: SETUP FAIL - {initial}")
                fail_count += 1
                continue
            
            ok = drag_block(page, 0, 3, 0.8)
            if not ok:
                results.append(f"#{i+1}: DRAG EXEC FAIL")
                fail_count += 1
                continue
            
            result = get_block_order(page)
            expected = ['B', 'C', 'D', 'A']
            
            status = "✅" if result == expected else "❌"
            if result == expected:
                success_count += 1
            else:
                fail_count += 1
            
            results.append(f"#{i+1}: {status} {result} (期望 {expected})")
        
        browser.close()
        
        print("\n" + "=" * 50)
        print(f"测试结果: {success_count}/10 通过, {fail_count}/10 失败")
        print("=" * 50)
        for r in results:
            print(r)


if __name__ == '__main__':
    test_repeat_drag()
