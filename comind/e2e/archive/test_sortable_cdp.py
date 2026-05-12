"""Sortable.js 拖拽测试 - 使用 Playwright dragTo API"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5175"
RESULTS = []

def log(id, name, passed, details=""):
    m = "PASS" if passed else "FAIL"
    print(f"  [{id}] {name}: {m}  {details}")
    RESULTS.append((id, name, passed))

def clear_idb(p):
    p.evaluate("""() => {
        indexedDB.databases().then(ds => ds.forEach(db => indexedDB.deleteDatabase(db.name)));
    }""")
    time.sleep(0.2)

def wait_db(p, timeout=3):
    prev = None
    for _ in range(int(timeout / 0.1)):
        cur = p.evaluate("""() => new Promise(r => {
            const req = indexedDB.open('comind');
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('blocks')) { r(''); return; }
                const tx = db.transaction('blocks', 'readonly');
                tx.objectStore('blocks').getAll().onsuccess = e => r(JSON.stringify(e.target.result));
            };
        })""")
        if cur == prev and prev != '':
            break
        prev = cur
        time.sleep(0.1)

def type_blocks(p, names):
    p.locator(".block-content").first.click()
    time.sleep(0.15)
    for i, n in enumerate(names):
        p.keyboard.type(n)
        if i < len(names) - 1:
            p.keyboard.press("Enter")
            time.sleep(0.1)
    p.keyboard.press("Escape")
    time.sleep(0.4)
    wait_db(p)

def dom_order(p):
    return p.evaluate("""() => {
        const items = [];
        function walk(block) {
            const text = block.querySelector('.block-content')?.textContent?.trim();
            if (text) items.push(text);
            const child = block.querySelector('.block-children');
            if (child) child.querySelectorAll(':scope > .block').forEach(walk);
        }
        document.querySelectorAll('.block-list > .block').forEach(walk);
        return items;
    }""")

def db_order(p):
    return p.evaluate("""() => new Promise(r => {
        const req = indexedDB.open('comind');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('blocks')) { r([]); return; }
            const tx = db.transaction('blocks', 'readonly');
            tx.objectStore('blocks').getAll().onsuccess = e => r(e.target.result.map(b => b.content));
        };
    })""")

# ---- Test Cases ----

def t_drag_start_style(p):
    """拖拽开始时 .block-drag class 存在"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["A", "B"])

    src = p.locator(".block").filter(has_text="A").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="B")

    src.hover()
    time.sleep(0.1)

    # 直接用 mouse 模拟 dragstart
    box = src.bounding_box()
    cx, cy = box["x"] + box["width"]/2, box["y"] + box["height"]/2
    p.mouse.move(cx, cy)
    p.mouse.down()
    # 触发 sortable 原生 dragstart
    p.mouse.move(cx + 10, cy, steps=3)
    time.sleep(0.1)
    has_drag = p.evaluate("() => document.querySelectorAll('.block-drag').length > 0")
    p.mouse.up()
    time.sleep(0.2)
    log("L-01", "拖拽开始样式", has_drag, f".block-drag={has_drag}")

def t_drag_up(p):
    """B 拖到 A 前面 → [B, A, C]"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["A", "B", "C"])

    src = p.locator(".block").filter(has_text="B").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="A")

    src.hover()
    time.sleep(0.1)
    box_s = src.bounding_box()
    box_d = dst.bounding_box()

    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2 - 5, steps=10)
    p.mouse.up()
    time.sleep(0.4)

    order = dom_order(p)
    log("S-01", "同容器向上拖拽", order == ["B", "A", "C"], f"实际: {order}")

def t_drag_down(p):
    """A 拖到 C 后面 → [B, C, A]"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["A", "B", "C"])

    src = p.locator(".block").filter(has_text="A").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="C")

    box_s = src.bounding_box()
    box_d = dst.bounding_box()

    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2 + 30, steps=10)
    p.mouse.up()
    time.sleep(0.4)

    order = dom_order(p)
    log("S-02", "同容器向下拖拽", order == ["B", "C", "A"], f"实际: {order}")

def t_indent_child(p):
    """Tab 缩进 → Child 成为 Parent 的子节点"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["Parent", "Child"])

    child_block = p.locator(".block").filter(has_text="Child")
    child_block.locator(".block-content").click()
    time.sleep(0.1)
    p.keyboard.press("Tab")
    time.sleep(0.4)

    db = db_order(p)
    child = next((c for c in db if c == "Child"), None)
    parent = next((c for c in db if c == "Parent"), None)
    # 在 DOM 中检查父子关系
    dom = dom_order(p)
    ok = dom == ["Parent"] and p.locator(".block").filter(has_text="Parent").locator(".block-children .block").filter(has_text="Child").count() > 0
    log("X-02", "缩进成子节点", ok, f"DOM顺序: {dom}")

def t_cycle_block(p):
    """父子关系建立后，父不能拖入子树下"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["Parent", "Child"])

    # 缩进 Child → Parent 的子节点
    child_block = p.locator(".block").filter(has_text="Child")
    child_block.locator(".block-content").click()
    p.keyboard.press("Tab")
    time.sleep(0.4)

    # 尝试拖 Parent → Child（循环检测应阻止）
    src = p.locator(".block").filter(has_text="Parent").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="Child")

    box_s = src.bounding_box()
    box_d = dst.bounding_box()

    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2 + 30, steps=10)
    p.mouse.up()
    time.sleep(0.4)

    dom = dom_order(p)
    # Parent 应该仍在顶层（循环被阻止）
    ok = dom[0] == "Parent" and "Child" in dom
    log("R-01", "循环检测", ok, f"DOM: {dom}")

def t_dom_db_consistency(p):
    """拖拽后 DOM 与 IndexedDB 一致"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["X", "Y"])

    src = p.locator(".block").filter(has_text="X").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="Y")

    box_s = src.bounding_box()
    box_d = dst.bounding_box()

    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2 + 30, steps=10)
    p.mouse.up()
    time.sleep(0.5)

    dom = dom_order(p)
    db = db_order(p)
    ok = dom == db
    log("L-04", "DOM/DB一致性", ok, f"DOM:{dom} DB:{db}")

def t_three_level(p):
    """三级嵌套拖拽"""
    clear_idb(p)
    p.reload()
    time.sleep(0.6)
    type_blocks(p, ["L1", "L2", "L3"])

    # L2 缩进
    p.locator(".block").filter(has_text="L2").locator(".block-content").click()
    p.keyboard.press("Tab")
    time.sleep(0.2)

    # L3 缩进
    p.locator(".block").filter(has_text="L3").locator(".block-content").click()
    p.keyboard.press("Tab")
    time.sleep(0.4)

    # L1 拖到 L3 后面（L3 不在 L1 子树 → 应成功）
    src = p.locator(".block").filter(has_text="L1").locator(".block-bullet")
    dst = p.locator(".block").filter(has_text="L3")

    box_s = src.bounding_box()
    box_d = dst.bounding_box()

    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2 + 30, steps=10)
    p.mouse.up()
    time.sleep(0.4)

    order = dom_order(p)
    log("X-01", "跨级拖拽", order == ["L3"], f"实际: {order}")

# ---- Main ----

def main():
    print("=" * 60)
    print("Sortable.js 拖拽功能测试 (direct CDP + Playwright)")
    print("=" * 60)

    # 确保 Chrome 正在运行 (launch_chrome.py 应该已启动)
    import urllib.request
    try:
        r = urllib.request.urlopen("http://localhost:9222/json/version", timeout=3)
        print("CDP 检查: OK")
    except:
        print("错误: Chrome CDP 不可用，请先运行 launch_chrome.py")
        return

    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp("http://localhost:9222")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        print(f"打开 {BASE}...")
        page.goto(BASE, timeout=15000)
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(1)
        print(f"  标题: {page.title()}")

        for t in [t_drag_start_style, t_drag_up, t_drag_down, t_indent_child,
                  t_cycle_block, t_dom_db_consistency, t_three_level]:
            try:
                print(f"\n  > {t.__name__}...")
                t(page)
            except Exception as e:
                log(t.__name__, "异常", False, str(e)[:60])

        ctx.close()
        browser.close()

    passed = sum(1 for _, _, ok in RESULTS if ok)
    total = len(RESULTS)
    print(f"\n{'='*60}")
    print(f"结果: {passed}/{total} 通过")
    for id, name, ok in RESULTS:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print("=" * 60)

if __name__ == "__main__":
    import sys
    sys.exit(0 if main() else 1)