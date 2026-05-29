# PageItem 菜单按钮设计文档

## 概述

为侧边栏的每个页面项（PageItem）添加菜单按钮，提供重命名和删除操作。同时保留原有的右上角全局菜单按钮。

## 设计决策

### 组件架构

采用**方案 C（混合方案）**：
- 保留现有的 `PageMenuButton.vue` 不变（用于右上角全局菜单）
- 新建 `PageItemMenu.vue` 组件（用于侧边栏页面项菜单）
- 两个组件保持独立，职责清晰

### 菜单功能

菜单项：
1. **重命名**：点击后将页面标题变为可编辑状态，按 Enter 确认，Esc 取消
2. **删除**（子菜单）：
   - 移至回收站
   - 永久删除

### UI 设计

**菜单按钮：**
- 图标：`MoreVertical`（三个点垂直排列）
- 大小：20x20px
- 位置：PageItem 最右侧（通过 suffix slot）
- 样式：透明背景，hover 时显示背景，始终显示

**菜单下拉：**
- 样式与 PageMenuButton 保持一致
- 菜单项高度：32px
- 重命名图标：`Pencil`
- 删除图标：`Trash2`
- 子菜单箭头图标：`ChevronRight`

### 交互细节

- 点击菜单按钮显示下拉菜单（@click.stop）
- 点击外部区域关闭菜单
- 菜单操作不会触发 PageItem 的点击事件
- 删除操作需要确认（复用现有的 ConfirmDialog）

## 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/Sidebar/PageItemMenu.vue` | 新增 | 页面项菜单组件 |
| `src/components/Sidebar/PageItem.vue` | 修改 | 添加菜单按钮占位 |
| `src/components/Sidebar/SidebarRecent.vue` | 修改 | 传递菜单按钮 |
| `src/components/Sidebar/SidebarFavorites.vue` | 修改 | 传递菜单按钮（替换现有删除按钮） |

## 数据流程

```
用户点击菜单按钮
    ↓
PageItemMenu 显示下拉菜单
    ↓
用户选择操作（重命名/删除）
    ↓
调用 usePageStore 方法执行操作
    ↓
关闭菜单，更新 UI
```

## 风险与注意事项

1. **菜单关闭时机**：确保点击菜单项后立即关闭菜单
2. **事件冒泡**：使用 @click.stop 防止触发 PageItem 的点击事件
3. **确认对话框**：删除操作需要用户二次确认
4. **重命名冲突**：处理重名情况（复用现有的 renamePage 逻辑）
