# Typed Link Split Bug 修复

## 问题描述

在含有 typed link（如 `((属于))[[D]]sd`）的 block 中按 Enter 拆分时，
当 relationship type（英文）与 label（中文）长度不同时，拆分位置错误。

**用户案例**：`"((是一个))[[D]]sd"` 在行尾按 Enter，变成 `"((是一个))[[D]]s"` + `"d"`（应在行尾不拆分）。

## 根因

**坐标系不匹配**：

- `cursorPosArg`（`selection.from`）基于编辑器显示的 **decoded 文本**（中文 label，如 `((属于))`）
- `insertBlockAtCursor` 中的 `block.content` 是 **encoded 文本**（英文 type，如 `((part-of))`）
- `pmPosToTextOffset = pmPos - 1` 不考虑 encode/decode 长度差异

当 type 比 label 长（如 `part-of`(7) vs `属于`(2)）：
- decoded 文本偏移 = 13（行尾）
- encoded 文本长度 = 18
- `textOffset = 13 < contentLen = 18` → 误判为 `isInMiddle` → 错误拆分

## 修复方案

在 `handleSplit`（`useBlockEditorLifecycle.ts`）中增加坐标转换逻辑：

1. **行尾**（`decodedOffset >= decodedText.length`）：直接设 `effectivePos = encodedContent.length + 1`
2. **行首**（`decodedOffset === 0`）：`effectivePos = 1`（无需转换）
3. **中间**：取 `decodedBefore = decodedText.slice(0, decodedOffset)`，对其 encode 得到 `encodedBefore`，`effectivePos = encodedBefore.length + 1`

中间场景的 encode 需要重新 build snapshot：对 `block.content`（已 encoded）执行 `decodeRelationshipContent` 得到 fresh snapshot。

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/components/Block/composables/useBlockEditorLifecycle.ts` | 导入 `decodeRelationshipContent`；`handleSplit` 中增加三路坐标转换 |
| `src/components/Block/composables/useBlockEditorLifecycle.test.ts` | 新增 typed link 行尾场景测试 |

## 验证

- `vue-tsc --noEmit`：0 错误
- `useBlockEditorLifecycle.test.ts`：2/2 handleSplit 测试通过（含新测试）
- `blocks.test.ts`：67/67 测试通过
- Pre-existing 失败（`handleContentClick > opens relationship switch menu`）与本次修改无关

## 未覆盖

- 中间拆分场景的集成测试（需要 `useRelationshipTypes` 完整初始化）
- 用户原始案例 `is-a`/`是一个`（长度相同）的复现——可能涉及其他因素（光标实际位置、时序问题）
