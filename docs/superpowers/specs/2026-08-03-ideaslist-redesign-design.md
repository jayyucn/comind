# IdeasList 左右分栏重设计

> 日期：2026-08-03
> 状态：已批准
> 作者：Brainstorming 会话

## 1. 背景与目标

### 现状

`/ideas` 路由当前在 `IdeasList.vue` 中垂直堆叠所有日期的点滴页面。每个 `IdeasListItem.vue` 内联渲染完整 `BlockList.vue`（今日可编辑、非今日冻结只读）。所有日期共用一个滚动容器（App.vue 的 `.content-body`）。

### 问题

- 今日点滴与历史日期视觉权重相同，无法快速区分
- 历史日期多时（100+）DOM 节点膨胀，滚动性能下降
- 垂直堆叠占满视口，今日内容无法"始终在视野内"

### 目标

1. **左右分栏**：左侧展示今日 Page（突出显示），右侧展示历史日期列表
2. **视觉层级**：今日区域视觉层级高于右侧列表
3. **独立滚动**：左右区域可独立滚动，不影响整体布局
4. **虚拟滚动**：右侧列表支持 100+ 天流畅滚动
5. **风格一致**：保持 Stone + Indigo 设计令牌体系
6. **全套动效**：骨架屏、渐入、sticky date header 等
7. **性能优化**：组件拆分、懒加载、虚拟滚动

### 非目标

- 不改变路由结构（`/ideas/:date` 保持不变）
- 不修改 BlockList、useIdeas、useIdeasFreeze 等现有核心逻辑
- 不添加日期切换/导航/展开交互（右侧纯展示）
- 不添加可配置排序 UI（仅默认倒序）

---

## 2. 架构设计

### 组件结构

```
IdeasList.vue (修改)
  ├── 数据编排层：todayPage + historyPages 分离
  ├── 左：IdeasTodayPanel.vue (新) — 今日可编辑
  │     └── 复用 BlockList.vue + useIdeasFreeze
  └── 右：IdeasHistoryList.vue (新) — 虚拟滚动容器
        └── IdeasHistoryItem.vue (新) × N — 单项只读
              └── 复用 BlockList.vue + useIdeasFreeze(已冻结)
```

### 文件变更

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `src/components/Ideas/IdeasList.vue` | 数据编排 + 左右分栏模板 |
| 新增 | `src/components/Ideas/IdeasTodayPanel.vue` | 左栏今日区域 |
| 新增 | `src/components/Ideas/IdeasHistoryList.vue` | 右栏虚拟滚动容器 |
| 新增 | `src/components/Ideas/IdeasHistoryItem.vue` | 右栏单项（只读） |
| 删除 | `src/components/Ideas/IdeasListItem.vue` | 被 IdeasHistoryItem 替代 |
| 新增依赖 | `vue-virtual-scroller` | 虚拟滚动 |

### 不修改

- `BlockList.vue` — 直接复用，冻结逻辑由 `useIdeasFreeze` 自动处理
- `useIdeasFreeze.ts` — 冻结逻辑不变
- `routes.ts` — 路由不变
- 设计 tokens — 不变
- `App.vue` — 不变

### 需微调

- `useIdeas.ts` — 将 `isTodayTitle` 从私有函数改为导出函数（1 行改动）

---

## 3. 布局与视觉（方案 A · 60/40）

### 整体布局

```
┌─────────────────────────────────────────────────────┐
│  .content-body (App.vue, 唯一垂直滚动容器)          │
│  ┌─────────────────────────────────────────────────┐ │
│  │  IdeasList.vue (height: 100%, 自身不滚动)        │ │
│  │  ┌──────────────────┬──────────────────────────┐ │ │
│  │  │  左 60%          │  右 40%                  │ │ │
│  │  │  IdeasTodayPanel │  IdeasHistoryList        │ │ │
│  │  │                  │  (RecycleScroller)      │ │ │
│  │  │  ┌────────────┐  │  ┌────────────────────┐ │ │ │
│  │  │  │ 今日卡片    │  │  │ sticky: 历史·倒序  │ │ │ │
│  │  │  │ 浅靛边+阴影 │  │  ├────────────────────┤ │ │ │
│  │  │  │            │  │  │ 8月2日 · BlockList  │ │ │ │
│  │  │  │ BlockList  │  │  ├────────────────────┤ │ │ │
│  │  │  │ (可编辑)   │  │  │ 8月1日 · BlockList  │ │ │ │
│  │  │  │            │  │  ├────────────────────┤ │ │ │
│  │  │  │ ↕ 独立滚动 │  │  │ ...                  │ │ │ │
│  │  │  └────────────┘  │  │ ↕ 独立滚动+虚拟    │ │ │ │
│  │  │                  │  └────────────────────┘ │ │ │
│  │  └──────────────────┴──────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 视觉层级

| 元素 | 背景 | 边框 | 阴影 | 说明 |
|------|------|------|------|------|
| 今日卡片 | `#fff` | `1px solid --accent-subtle` | `0 4px 12px rgba(99,102,241,0.12)` | 视觉"浮起"，层级最高 |
| 历史日期项 | `#fff` | `1px solid --border` | 无 | 纯白卡，作为衬托 |
| 分隔线 | — | `1px solid --border` | — | 两栏之间 |

### 今日卡片头部

- "今天" badge：靛色 `--accent` 背景 + 白色文字
- 日期文字：`2026年8月3日 周日`
- "可编辑"标签

### 历史日期项头部

- 日期数字 + 星期
- 无 badge，无装饰

---

## 4. 数据流

### IdeasList.vue

```typescript
// 需要从 useIdeas.ts 新增导出 isTodayTitle（当前为私有函数）
const { ideasPages, isTodayTitle } = useIdeas()

const todayPage = computed(() => {
  return ideasPages.value.find(p => isTodayTitle(p.title))
})

const historyPages = computed(() => {
  return ideasPages.value
    .filter(p => !isTodayTitle(p.title))
    .sort((a, b) => b.title.localeCompare(a.title))
})
```

### 加载流程

1. `onMounted`: `pageStore.loadAllPages()` → `blockStore.loadMultiPageBlocks(allIdeasPageIds)`
2. `todayPage` / `historyPages` computed 自动响应 store 变化
3. 左右组件通过 props 接收数据，各自渲染

### 虚拟滚动

- 组件：`vue-virtual-scroller` 的 `RecycleScroller`
- 预估高度：300px/项（渲染后自动校正）
- Buffer：5 项（预渲染上下 5 项）
- 降级：通过 flag 控制，异常时回退到 `v-for`

---

## 5. 动效规格

| 场景 | 动效 | 参数 |
|------|------|------|
| 页面首次进入 | 两栏渐入 | `fade-in` 200ms ease-out，左先右后（延迟 80ms） |
| 右侧滚动 | sticky date header | CSS `position: sticky` + `backdrop-filter: blur(4px)` |
| Block 加载 | 骨架屏 | 左栏 `.shimmer` 动画，右栏紧凑骨架 |
| Block 加载完成 | 骨架→内容 | `opacity` 过渡 200ms |
| 空状态 | 图标渐入 | `fade-in` 300ms |

**不做**：日期切换动画、列表项增删动画。

---

## 6. 滚动行为

- **左栏**：`overflow-y: auto`，滚动条隐藏（`scrollbar-width: none`）
- **右栏**：`RecycleScroller` 内部管理滚动，外层 `overflow: hidden`
- **整体**：IdeasList 自身不滚动，`height: 100%` + `overflow: hidden` 填满 `.content-body`
- **不修改 App.vue**：`.content-body` 保持 `overflow-y: auto`。由于 IdeasList 精确占满视口高度，外层不会产生可见滚动条。左右栏各自独立滚动通过内部容器实现

---

## 7. 错误处理

| 场景 | 处理 |
|------|------|
| 今日页面不存在 | 左栏显示"正在创建今日点滴…"加载态（useIdeas.checkAndEnsureTodayIdeas 已在 App.vue 启动时兜底） |
| 历史列表为空（仅今日） | 右栏显示"暂无历史点滴"空状态 |
| BlockStore 加载失败 | 全局 ErrorBoundary + Toast |
| 虚拟滚动异常 | 降级为普通 `v-for` 渲染 |

---

## 8. 性能优化

| 优化点 | 方案 | 预期收益 |
|--------|------|----------|
| 虚拟滚动 | `RecycleScroller` 仅渲染视口内日期项 | 100+ 天场景 DOM 从 ~2000 降至 ~50 |
| BlockList 懒加载 | 历史项的 BlockList 仅在进入视口时挂载 | 空闲内存降低 |
| CSS 隔离 | 新组件样式 scoped | 样式零回归风险 |
| 组件拆分 | 3 个新组件均 < 100 行 | Vue 编译优化友好 |

---

## 9. 测试策略

| 测试类型 | 覆盖范围 | 工具 |
|----------|----------|------|
| 单元测试 | IdeasList 的 today/history 分离逻辑 | Vitest |
| 组件测试 | IdeasTodayPanel 渲染 + 可编辑；IdeasHistoryItem 渲染 + 冻结 | Vitest + @vue/test-utils |
| 浏览器 E2E | 左右分栏布局、独立滚动、虚拟滚动正确渲染 | Playwright |
| 编译检查 | `npm run build`（vue-tsc + vite build） | 项目规范 |

---

## 10. 实施步骤

1. 新增 `vue-virtual-scroller` 依赖 → 验证：`npm run build`
2. 重写 `IdeasList.vue` 数据分离逻辑 → 验证：单元测试通过
3. 创建 `IdeasTodayPanel.vue`（左栏）→ 验证：组件测试通过
4. 创建 `IdeasHistoryItem.vue`（右单项）→ 验证：组件测试通过
5. 创建 `IdeasHistoryList.vue`（右栏+虚拟滚动）→ 验证：虚拟滚动渲染正确
6. 删除 `IdeasListItem.vue` → 验证：无引用残留
7. 添加骨架屏与渐入动效 → 验证：视觉验收
8. E2E 测试编写与执行 → 验证：Playwright 通过
9. 编译检查 + 整体回归 → 验证：`npm run build`

---

## 11. 设计约束汇总

- **新增依赖**：`vue-virtual-scroller`
- **修改文件**：`IdeasList.vue`、`useIdeas.ts`（导出 `isTodayTitle`）
- **新增文件**：`IdeasTodayPanel.vue`、`IdeasHistoryList.vue`、`IdeasHistoryItem.vue`
- **删除文件**：`IdeasListItem.vue`
- **零改动**：BlockList.vue、useIdeasFreeze.ts、routes.ts、设计 tokens、App.vue
