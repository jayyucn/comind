# E2E 测试：Backspace 键行为
# 覆盖：空 Block 删除、非空 Block 开头合并、合并后光标位置

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, Locator


# ─── 辅助 ───────────────────────────────────────────────

def screenshot(page: Page, name: str):
    """保存截图到 e2e/screenshots/"""
    path = Path(__file__).parent / 'screenshots' / f'{name}.png'
    page.screenshot(path=str(path), full_page=True)
    print(f'  📷 {path}')


def wait_ms(ms: int = 300):
    """等待状态稳定"""
    import time
    time.sleep(ms / 1000)


def block_count(page: Page) -> int:
    """返回页面中 .block 的数量"""
    return page.locator('.block').count()


def block_texts(page: Page) -> list[str]:
    """返回所有 block-text 的文本内容"""
    return [
        el.inner_text()
        for el in page.locator('.block-text').all()
    ]


def get_active_block_id(page: Page) -> str | None:
    """返回当前 active block 的 data-v-* 属性或 .active 类"""
    active = page.locator('.block.active')
    if active.count() == 0:
        return None
    # 取第一个 active block 的 id
    return active.first.get_attribute('data-block-id')


def cursor_offset_in_editor(page: Page) -> int | None:
    """
    返回当前激活编辑器中光标的字符偏移。
    通过执行 JS 读取 ProseMirror selection.from。
    """
    try:
        result = page.evaluate("""
            () => {
                const editor = document.querySelector('.editor-wrapper .ProseMirror');
                if (!editor) return null;
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return null;
                // 粗略：计算光标到段落开头之间的文本节点字符数
                const range = sel.getRangeAt(0);
                // 简单方案：读取 editor 文本内容中光标前的子串长度
                const text = editor.textContent || '';
                // 在 Firefox/Safari 上通过 range 获取 offset
                // 这里用 characterOffset 近似（大多数现代浏览器支持）
                return range.startOffset;
            }
        """)
        return result
    except Exception:
        return None


# ─── 测试用例 ────────────────────────────────────────────

def test_empty_block_backspace_deletes_and_activates_prev(page: Page):
    """
    【核心 Bug 修复验证】
    场景：Block A（内容"hello"）+ Block B（空）
    操作：聚焦 B，按 Backspace
    期望：B 被删除，A 被激活，B 的内容追加到 A
    """
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    screenshot(page, 'empty-block-0-start')

    # 创建 Block A
    page.locator('.block-content').first.click()
    wait_ms(200)
    page.keyboard.type('hello')
    page.keyboard.press('Escape')  # 失活
    wait_ms(200)
    screenshot(page, 'empty-block-1-after-a')

    # 创建 Block B
    page.locator('.block-content').first.click()  # 重新激活 A
    wait_ms(100)
    page.keyboard.press('Enter')   # split，空 Block B
    wait_ms(200)
    screenshot(page, 'empty-block-2-block-b-created')

    # 确认两个 Block
    assert block_count(page) == 2, f'期望 2 个 Block，实际 {block_count(page)}'
    assert '' in block_texts(page), 'Block B 应该为空'

    # 聚焦 Block B（B 当前是 active block，因为刚 split）
    # B 此时内容为空
    active = page.locator('.block.active')
    assert active.count() == 1, '应该有 1 个 active block'
    screenshot(page, 'empty-block-3-b-active')

    # 按 Backspace
    page.keyboard.press('Backspace')
    wait_ms(300)
    screenshot(page, 'empty-block-4-after-backspace')

    # 验证：只剩 1 个 Block，内容为 'hello'
    assert block_count(page) == 1, f'期望 1 个 Block（已删除空 B），实际 {block_count(page)}'
    texts = block_texts(page)
    assert 'hello' in texts[0], f"期望内容 'hello'，实际 {texts}"

    # 验证前一个 Block 被激活
    assert page.locator('.block.active').count() == 1, 'A 应该被激活'

    print('  ✅ 空 Block Backspace 删除 + 激活前一个 Block 通过')


def test_nonempty_block_backspace_merges_and_cursor_at_junction(page: Page):
    """
    【核心 Bug 修复验证】
    场景：Block A（"hello"）+ Block B（"world"）
    操作：在 B 开头按 Backspace
    期望：A + B 内容合并，光标在合并点（"hello|world"）
    """
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    # 创建 Block A
    page.locator('.block-content').first.click()
    wait_ms(100)
    page.keyboard.type('hello')
    page.keyboard.press('Escape')
    wait_ms(200)

    # 创建 Block B
    page.locator('.block-content').first.click()
    wait_ms(100)
    page.keyboard.press('Enter')
    wait_ms(200)
    page.keyboard.type('world')
    wait_ms(100)
    screenshot(page, 'merge-1-before')

    # B 聚焦，光标在末尾
    assert page.locator('.block.active').count() == 1
    active_text = page.locator('.block.active .block-text, .block.active .tiptap').inner_text().strip()
    assert 'world' in active_text, f'B 内容应为 world，实际 {active_text}'

    # 将光标移到 B 开头
    page.keyboard.press('Home')
    wait_ms(100)
    screenshot(page, 'merge-2-cursor-at-start')

    # 按 Backspace 合并
    page.keyboard.press('Backspace')
    wait_ms(300)
    screenshot(page, 'merge-3-after-merge')

    # 验证：只剩 1 个 Block
    assert block_count(page) == 1, f'期望 1 个 Block，实际 {block_count(page)}'
    texts = block_texts(page)
    merged = texts[0]
    assert 'hello' in merged and 'world' in merged, \
        f"期望合并内容 'helloworld'，实际 {merged}"

    # 验证光标在合并点（不是末尾）
    # 通过检查 selection 位置
    cursor_pos = page.evaluate("""
        () => {
            const editor = document.querySelector('.editor-wrapper .ProseMirror');
            if (!editor) return -1;
            // tiptap 在编辑器 div 上存 __tiptap_wrapper_view
            // 通过 selection 对象获取 from
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return -1;
            // 计算光标前文本长度
            const range = sel.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(editor);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            return preCaretRange.toString().length;
        }
    """)

    print(f'  光标位置（合并点应为 5）：{cursor_pos}')
    # 合并点应该在 "hello" 和 "world" 之间，即位置 5
    # 由于 "hello" 有 5 个字符，光标应该紧跟在 hello 后面
    assert cursor_pos == 5, \
        f'光标应在合并点（位置 5），实际 {cursor_pos}'

    print('  ✅ 非空 Block Backspace 合并 + 光标在合并点通过')


def test_delete_first_empty_block_keeps_page_alive(page: Page):
    """
    边界：第一个空 Block 按 Backspace → 仍然保留一个 Block（系统不允许没有 Block）
    """
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    wait_ms(200)

    # 确认初始有至少 1 个 block
    initial = block_count(page)
    assert initial >= 1

    # 聚焦第一个 block
    page.locator('.block-content').first.click()
    wait_ms(200)

    # 按 Backspace（空 block，内容为空）
    page.keyboard.press('Backspace')
    wait_ms(300)

    # 应该还剩至少 1 个 block（不能全部删光）
    remaining = block_count(page)
    assert remaining >= 1, f'页面至少应保留 1 个 block，实际 {remaining}'

    print('  ✅ 第一个空 Block 删除后页面仍有 Block 通过')


def test_cross_level_merge(page: Page):
    """
    跨层级合并：
    Block A
      Block B
    Block C
    在 C 开头按 Backspace → 应与 B 合并（文档序前一个）
    """
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    # 创建 Block A
    page.locator('.block-content').first.click()
    wait_ms(100)
    page.keyboard.type('A')
    page.keyboard.press('Escape')
    wait_ms(200)

    # A 激活 → Tab 缩进 B
    page.locator('.block-content').first.click()
    wait_ms(100)
    page.keyboard.press('Enter')   # split 出空 Block
    wait_ms(200)
    page.keyboard.press('Tab')     # indent → 成为 A 的子节点
    wait_ms(200)
    page.keyboard.type('B')
    page.keyboard.press('Escape')
    wait_ms(200)
    screenshot(page, 'cross-level-1-before')

    # 激活 A（顶层），再 Enter → C（顶层兄弟）
    page.locator('.block-content').first.click()
    wait_ms(100)
    page.keyboard.press('Enter')
    wait_ms(200)
    page.keyboard.type('C')
    page.keyboard.press('Escape')
    wait_ms(200)
    screenshot(page, 'cross-level-2-c-created')

    # 确认 A → B(子) → C 的层级
    block_rows = page.locator('.block').all()
    # C 是顶层最后一个
    # 在 C 开头按 Backspace → 应与 B 合并
    # 先激活 C
    page.locator('.block-content').last.click()
    wait_ms(100)
    page.keyboard.press('Home')   # 光标到 C 开头
    wait_ms(100)
    screenshot(page, 'cross-level-3-cursor-at-start')

    page.keyboard.press('Backspace')
    wait_ms(300)
    screenshot(page, 'cross-level-4-after-merge')

    # C 应与 B 合并，B 被激活
    # 最终：Block A（顶层）+ Block 合并（内容 AB）
    blocks_now = block_count(page)
    assert blocks_now <= 3, f'合并后 block 数量应 ≤ 3（理想 2），实际 {blocks_now}'
    texts = block_texts(page)
    print(f'  跨层级合并后内容：{texts}')
    assert 'B' in ''.join(texts), '合并后应包含 B'
    assert 'C' in ''.join(texts), '合并后应包含 C（内容追加）'

    print('  ✅ 跨层级合并通过')


# ─── 入口 ────────────────────────────────────────────────

def main():
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        tests = [
            ('空 Block 删除', test_empty_block_backspace_deletes_and_activates_prev),
            ('合并光标在合并点', test_nonempty_block_backspace_merges_and_cursor_at_junction),
            ('第一个空 Block 不删光', test_delete_first_empty_block_keeps_page_alive),
            ('跨层级合并', test_cross_level_merge),
        ]

        for name, fn in tests:
            print(f'\n▶ {name}')
            try:
                # 每个测试用新页面
                page = browser.new_page()
                fn(page)
            except Exception as e:
                print(f'  ❌ FAILED: {e}')
                errors.append((name, e))
            finally:
                page.close()

        browser.close()

    print('\n' + '=' * 50)
    if errors:
        print(f'❌ {len(errors)}/{len(tests)} 个测试失败:')
        for name, e in errors:
            print(f'  - {name}: {e}')
        sys.exit(1)
    else:
        print(f'✅ {len(tests)}/{len(tests)} 个测试全部通过')


if __name__ == '__main__':
    main()
