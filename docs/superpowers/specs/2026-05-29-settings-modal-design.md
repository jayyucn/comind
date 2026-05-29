# 设置模态窗口设计

## 背景

当前设置界面是独立路由页面 (`/settings`)，通过右上角菜单按钮导航进入。改为模态窗口可以避免离开当前页面，提升操作连贯性。

## 方案选择

选择**方案 A：左侧导航 + 右侧内容**的双栏布局。理由：
- 中型弹窗尺寸下双栏布局能充分利用空间
- 扩展性强，新增分类只需加导航项
- 分类切换直观，无需滚动

## 组件架构

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/components/Settings/SettingsModal.vue` | 模态窗口主组件，包含遮罩层、左侧导航、右侧内容区 |
| `src/composables/useSettingsModal.ts` | 提供 `isOpen` / `open()` / `close()` 的 composable |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/App.vue` | 引入 SettingsModal 组件 |
| `src/components/Sidebar/SidebarFooter.vue` | 新增设置图标按钮 |
| `src/components/PageMenuButton.vue` | 设置项从路由跳转改为调用 `open()` |
| `src/router/routes.ts` | 移除 `/settings` 路由 |

### 移除

- `/settings` 路由定义

### 组件层级

```
App.vue
├── Sidebar
│   └── SidebarFooter (新增设置按钮)
├── RouterView
├── PageMenuButton (修改：设置项改为调用 open())
└── SettingsModal (新增，Teleport to body)
    ├── 左侧导航 (分类列表)
    └── 右侧内容 (当前分类的设置项)
```

## 模态窗口交互

### 尺寸与定位

- 宽度 `720px`，高度 `max(480px, 70vh)`，居中
- 左侧导航宽度 `180px`，右侧内容区自适应
- 移动端响应式：宽度 `95vw`，左侧导航收缩为顶部下拉选择

### 打开/关闭

- 打开动画：淡入 + 轻微上移（`opacity` + `translateY`，180ms）
- 关闭动画：淡出（180ms）
- 三种关闭方式：点击遮罩层、按 Esc 键、点击右上角关闭按钮
- 关闭时不保存/不提示（当前所有设置项均为"即将推出"，无实际数据变更）

### 左侧导航

- 4 个分类项：外观、编辑器、数据管理、关于
- 当前选中项高亮（背景色 + 字重变化）
- 点击切换右侧内容，无路由变化

### 右侧内容区

- 显示当前选中分类的设置项
- 内容超出时垂直滚动
- 保持现有设置项的卡片式布局

### 遮罩层

- `backdrop-filter: blur(4px)`，与现有 ConfirmDialog / MergeDialog 一致
- `z-index: 1000`

## 入口触发点

### 入口 1：PageMenuButton 菜单

- 现有右上角菜单中的"设置"项，从 `router.push('/settings')` 改为调用 `open()`
- 菜单项文案和图标不变

### 入口 2：SidebarFooter 新增设置按钮

- 在侧边栏底部快捷键提示区域下方，新增设置图标按钮
- 使用 `lucide-vue-next` 的 `Settings` 图标
- 点击调用 `open()`
- 按钮样式与侧边栏其他元素一致

## 状态管理

`useSettingsModal` composable：

```ts
const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}
```

使用模块级单例模式（非 provide/inject），确保 PageMenuButton 和 SidebarFooter 调用的是同一个状态。
