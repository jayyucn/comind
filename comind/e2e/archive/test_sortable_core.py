r"""
Sortable.js 核心功能测试（简化版）
================================

覆盖关键测试用例：
- L-01: 拖拽开始生命周期
- L-04: 拖拽结束数据更新
- S-01/S-02: 同容器上下拖拽
- X-02: 跨容器拖入节点
- R-01: 循环检测

运行: python e2e/test_sortable_core.py
"""

from playwright.sync_api import sync_playwright, Page, Locator
import time
import sys

BASE_URL = "http://localhost:5175"
TEST_RESULTS = []

def log_result(test_id, name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    result = f"[{test_id}] {name}: {status}"
    if details:
        result += f" | {details}"
    print(result)
    TEST_RESULTS.append({"id": test_id, "name": name, "passed": passed})

def clear_idb(page: Page):
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

def wait_stable(page: Page, timeout_ms: int = 3000):
    import time as t
    start = t.time()
    prev = None
    while t.time() - start < timeout_ms / 1000:
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
                        resolve(JSON.stringify(getAllReq.result.map(b => b.content)));
                    };
                };
            });
        }''')
        if data and data != prev:
            prev = data
            t.sleep(0.1)
        elif data == prev:
            break

def create_blocks(page: Page, names: list):
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)
    for i, name in enumerate(names):
        page.keyboard.type(name)
        if i < len(names) - 1:
            page.keyboard.press('Enter')
            page.wait_for_timeout(80)
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    wait_stable(page)

def get_block(page: Page, content: str) -> Locator:
    return page.locator(f".block:has-text('{content}')").first

def get_bullet(block: Locator) -> Locator:
    return block.locator(".block-bullet")

def drag_block(page: Page, from_block: Locator, to_block: Locator, offset_y: int = 0):
    from_bullet = get_bullet(from_block)
    to_bullet = get_bullet(to_block)
    
    from_box = from_bullet.bounding_box()
    to_box = to_bullet.bounding_box()
    
    if not from_box or not to_box:
        raise ValueError("无法获取元素位置")
    
    page.mouse.move(from_box["x"] + from_box["width"]/2, from_box["y"] + from_box["height"]/2)
    page.mouse.down()
    page.mouse.move(to_box["x"] + to_box["width"]/2, to_box["y"] + to_box["height"]/2 + offset_y, steps=5)
    page.mouse.up()

def get_contents(page: Page) -> list:
    return page.evaluate('''() => {
        return Array.from(document.querySelectorAll('.block-content'))
            .map(el => el.textContent.trim()).filter(c => c);
    }''')

def get_data(page: Page) -> list:
    return page.evaluate('''() => {
        return new Promise((resolve) => {
            const req = indexedDB.open('comind');
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('blocks')) { resolve([]); return; }
                const tx = db.transaction('blocks', 'readonly');
                const store = tx.objectStore('blocks');
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => {
                    resolve(getAllReq.result.map(b => ({
                        content: b.content,
                        parentId: b.parentId
                    })));
                };
            };
        });
    }''')

# ============ 测试用例 ============

def test_L01_drag_start(page: Page):
    print("\n[L-01] 测试拖拽开始...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["A", "B", "C"])
    
    block_a = get_block(page, "A")
    bullet = get_bullet(block_a)
    box = bullet.bounding_box()
    
    page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
    page.mouse.down()
    page.mouse.move(box["x"] + 50, box["y"] + 50, steps=3)
    
    has_drag = page.evaluate('() => document.querySelector(".block-drag") !== null')
    page.mouse.up()
    page.wait_for_timeout(200)
    
    log_result("L-01", "拖拽开始生命周期", has_drag)

def test_L04_data_update(page: Page):
    print("\n[L-04] 测试拖拽结束数据更新...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["First", "Second", "Third"])
    
    first = get_block(page, "First")
    third = get_block(page, "Third")
    
    drag_block(page, first, third, offset_y=30)
    page.wait_for_timeout(300)
    
    contents = get_contents(page)
    data = get_data(page)
    data_contents = [b["content"] for b in data]
    expected = ["Second", "Third", "First"]
    
    passed = contents == expected and data_contents == expected
    log_result("L-04", "拖拽结束数据更新", passed, f"DOM:{contents}, Data:{data_contents}")

def test_S01_move_up(page: Page):
    print("\n[S-01] 测试同容器向上拖拽...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["One", "Two", "Three"])
    
    two = get_block(page, "Two")
    one = get_block(page, "One")
    
    drag_block(page, two, one, offset_y=-20)
    page.wait_for_timeout(300)
    
    contents = get_contents(page)
    passed = contents == ["Two", "One", "Three"]
    log_result("S-01", "同容器向上拖拽", passed, f"顺序:{contents}")

def test_S02_move_down(page: Page):
    print("\n[S-02] 测试同容器向下拖拽...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["One", "Two", "Three"])
    
    one = get_block(page, "One")
    three = get_block(page, "Three")
    
    drag_block(page, one, three, offset_y=30)
    page.wait_for_timeout(300)
    
    contents = get_contents(page)
    passed = contents == ["Two", "Three", "One"]
    log_result("S-02", "同容器向下拖拽", passed, f"顺序:{contents}")

def test_X02_drag_into(page: Page):
    print("\n[X-02] 测试拖入节点内部...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["Container", "Item"])
    
    container = get_block(page, "Container")
    item = get_block(page, "Item")
    
    drag_block(page, item, container, offset_y=30)
    page.wait_for_timeout(300)
    
    data = get_data(page)
    item_data = next((b for b in data if b["content"] == "Item"), None)
    container_data = next((b for b in data if b["content"] == "Container"), None)
    
    passed = item_data and container_data and item_data["parentId"] == container_data.get("id")
    log_result("X-02", "拖入节点内部", passed)

def test_R01_cycle_prevent(page: Page):
    print("\n[R-01] 测试循环检测...")
    clear_idb(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)
    
    create_blocks(page, ["Parent", "Child"])
    
    parent = get_block(page, "Parent")
    child = get_block(page, "Child")
    
    # 将 Child 缩进为 Parent 的子节点
    child.locator(".block-content").first.click()
    page.wait_for_timeout(100)
    page.keyboard.press("Tab")
    page.wait_for_timeout(300)
    
    # 尝试将 Parent 拖入 Child
    drag_block(page, parent, child, offset_y=30)
    page.wait_for_timeout(300)
    
    data = get_data(page)
    parent_data = next((b for b in data if b["content"] == "Parent"), None)
    
    passed = parent_data and parent_data["parentId"] is None
    log_result("R-01", "循环检测-父节点拖入子节点", passed)

# ============ 主函数 ============

def run_tests():
    print("=" * 50)
    print("Sortable.js 核心功能测试")
    print("=" * 50)
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        
        try:
            print(f"\n访问 {BASE_URL}...")
            page.goto(BASE_URL)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(1000)
            
            tests = [
                test_L01_drag_start,
                test_L04_data_update,
                test_S01_move_up,
                test_S02_move_down,
                test_X02_drag_into,
                test_R01_cycle_prevent,
            ]
            
            for test in tests:
                try:
                    test(page)
                except Exception as e:
                    test_id = test.__name__.split('_')[1].upper()
                    log_result(test_id, "测试异常", False, str(e)[:50])
                    
        finally:
            browser.close()
    
    # 报告
    print("\n" + "=" * 50)
    passed = sum(1 for r in TEST_RESULTS if r["passed"])
    failed = len(TEST_RESULTS) - passed
    print(f"结果: {passed}/{len(TEST_RESULTS)} 通过, {failed} 失败")
    print("=" * 50)
    
    if failed > 0:
        print("\n失败项:")
        for r in TEST_RESULTS:
            if not r["passed"]:
                print(f"  - [{r['id']}] {r['name']}")
    
    return failed == 0

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
