# Sidebar Redesign - v0.8

> 版本：v0.8.1（Journal 行为调整）(推翻 v0.7 重来)
> 日期:2026-04-23
> 状态:**评审通过**
> 评审:comind-review + frontend-design(2026-04-23 21:02)
> 触发:评审 v0.7 后发现结构性问题

---

## 评审 v0.7 发现的问题

v0.7 解决了"页面列表"的问题,但引入了新的结构性问题:

| 问题 | 描述 |
|------|------|
| **Search 重复** | SearchBar 点击触发 Ctrl+K,而 Ctrl+K 本身就是全局命令面板。Sidebar 里再放一个 SearchBar 是重复的入口 |
| **Journal 地位不足** | Journal 是 comind 的核心场景(日记流),但 v0.7 里只是 Section 内的一个 Button,视觉权重不够 |
| **Graph 无意义占位** | 一个写着"敬请期待"的占位元素,既不美观也没有信息量 |
| **Section 数量过多** | Header + Search + Journal + Recent + Favorites + Graph + Footer = 7 个 Zone,信息密度高但重点不突出 |
| **Search/Recent 有重叠** | Search = 搜索所有页面,Recent = 5 条最近编辑,功能有重叠,用户不知道该用哪个 |

---

## 重新定义 Sidebar 的使命

**一句话定位:**

> Sidebar = **快速启动盘**,不是浏览器,不是搜索框

**它只负责 3 件事:**

1. **今天**:今天要写什么?→ Journal
2. **刚才**:刚才在做什么?→ Recent(≤3条)
3. **常驻**:哪些页面需要一直可见?→ Favorites

**它不做的事:**
- ❌ 搜索(Ctrl+K 统一处理)
- ❌ 图谱(Phase 2 再说,放占位是噪音)
- ❌ 页面列表浏览(不是文件管理器)

---

## 新版结构(v0.8)

```
┌────────────────────────────────────────┐
│ COMIND                          [◀]   │  ← Header(44px)
├────────────────────────────────────────┤
│                                        │
│   🌤️ 今天                            │  ← Journal Hero Card
│   2026-04-23 · 周四                   │     高度: 80px
│   ▶ 打开日记                          │     背景: accent-subtle
│                                        │     重点: 今天的日期 + 入口
├────────────────────────────────────────┤
│ 最近                               [▼] │  ← Recent(≤3 条,折叠)
│   📄 数据模型设计          3 分钟前     │
│   📄 Phase 1 技术选型      昨天        │
├────────────────────────────────────────┤
│ ⭐ 收藏                               │  ← Favorites
│   📄 项目启动会议记录      4月1日       │
│   📄 + 添加收藏                     │
├────────────────────────────────────────┤
│  Ctrl+K · 命令与搜索                  │  ← Footer(kbd hint)
└────────────────────────────────────────┘
```

**对比 v0.7:**

| 变更 | v0.7 | v0.8 |
|------|------|------|
| Journal | Section 内 Button | Journal Card（80px，日记列表入口）|
| SearchBar | 有(独立 Zone)| 删除(Ctrl+K 统一入口)|
| Graph | 占位 Section | 删除(Phase 2 再加)|
| Recent 上限 | 5 条 | **3 条**(更克制)|
| Favorites 添加 | [+] 按钮 | 列表内 [+ 添加收藏] 项 |
| Footer hint | "斜杠命令 · Ctrl+K" | "Ctrl+K · 命令与搜索" |

---

## Journal(日记列表入口)

**定位变更(v0.8 → v0.8.1,根据 2026-04-23 21:26 用户反馈):**
| 变更 | 说明 |
|------|------|
| 入口 | 打开**日记列表**(不是直接打开当天日记)|
| 标题 | 不可修改,固定为日期(YYYY-MM-DD)|
| 创建 | 只能创建**当天**日记,第一次访问时触发 |
| 过往 | 不可编辑,仅读 |

**设计规格:**

```
尺寸: width: 100%, height: 80px
margin: 0 8px 4px
padding: 12px 12px 10px
radius: 8px
背景: var(--accent-subtle, #FEF3C7)
border: none
box-shadow: none

内部布局(flex column):
  [📔] [日记                              ]  ← 主行
  [查看全部                            →]  ← 入口(hover 时右移)

hover: 背景 → #FEF0C0,箭头 translateX(2px)
active: scale(0.96),80ms ease-out
```

**新的交互流程:**
1. 点击 Card → 打开**日记列表 Panel**
2. 列表显示所有日记 Page(按日期倒序)
3. 点击"今天"条目 → 创建今天日记(首次访问)
4. 过往条目 → 只读(hover 显示"仅查看")

**为什么这样改:**
- 日记是时间流,查看历史和创建新的是同一入口
- 标题固定日期,保证一致性
- 过往不可编辑,保证日记的不可篡改性

---

## Recent Section

```
SectionLabel: "最近", 10px 500, letter-spacing 0.1em, --text-tertiary
margin: 8px 8px 4px

最多显示 3 条(v0.7 是 5 条,更克制)
展开按钮 [▼]:[+] 区域右侧 20×20px,radius 4px
  hover: --bg-hover
  展开后显示最多 10 条,超出提示"查看全部 →"

PageItem:
  height: 32px(触控友好)
  padding: 4px 8px
  radius: 5px
  gap: 6px
  结构: [📄] [title ellipsis] [time]
  title: 13px, ellipsis, flex: 1
  time: 11px, JetBrains Mono, --text-tertiary
  active: 左 2px accent,背景 --bg-active,字重 500
  hover: 背景 --bg-hover
```

**排序规则:**
- 按 `Page.updatedAt` 降序排列
- 不考虑 Block 级联更新(仅 Page 级变更)

**为什么只显示 3 条:**
- Sidebar 总高度有限(常见 768px 屏幕)
- 3 条足够覆盖"刚才"的需求
- 超过 3 条 → 用 Ctrl+K 搜索

---

## Favorites Section

```
SectionLabel: "收藏", 10px 500, letter-spacing 0.1em, --text-tertiary
margin: 8px 8px 4px

"添加收藏" 作为最后一项存在:
  结构: [☆] [+ 添加收藏]
  样式: 13px, --text-tertiary, padding 同 PageItem
  hover: 背景 --bg-hover,颜色变 accent
  点击 → 触发 Ctrl+K 页面选择模式(方案 A:扩展 Ctrl+K 支持模式切换)

PageItem 样式同 Recent Section
```

**Ctrl+K 模式扩展:**
| 模式 | 触发 | 内容 |
|------|------|------|
| command | Ctrl+K / 斜杠 / | 命令列表(/date, /time, /page...)|
| page-select | 收藏添加点击 | 页面列表(搜索 + 选择)|

两种模式共用 UI 组件(CommandPalette.vue),通过 `mode` prop 区分内容源。

**为什么用列表内 [+ ] 而不是独立按钮:**
- v0.7 的 [+] 按钮在 SectionLabel 右侧,视觉上是"管理操作"
- [+ 添加收藏] 作为最后一项,暗示"收藏列表的延续",更自然

**空状态:**(无收藏时)
```
[☆] 暂无收藏
    点击上方添加
```
两行,13px,居左,--text-tertiary

---

## SidebarFooter

```
flex-shrink: 0
padding: 8px 12px
border-top: 1px solid var(--border)

内容: Ctrl+K · 命令与搜索
  10px, --text-tertiary, 居中
  Ctrl+K: kbd 样式(JetBrains Mono 9px,bg --bg-hover,border --border,padding 1px 4px,radius 3px)
```

**为什么改变 hint 文字:**
- v0.7 说"斜杠命令 · Ctrl+K 搜索"--斜杠命令和 Ctrl+K 是两件不同的事,不能并置
- 更准确的描述:"Ctrl+K · 命令与搜索"(说明 Ctrl+K 打开的是什么)
- 斜杠命令通过编辑器内 `/` 自然发现,不需要在 Sidebar 提示

---

## 组件结构(v0.8)

```
src/
├── components/
│   └── Sidebar/
│       ├── SidebarContainer.vue     # 主容器(flex column)
│       ├── SidebarHeader.vue         # Logo + 折叠按钮
│       ├── SidebarJournal.vue        # Journal Card（列表入口）
│       ├── SidebarRecent.vue          # Recent Section(复用 PageItem)
│       │   └── PageItem.vue          # 单条 Page 展示(Recent 和 Favorites 共用)
│       ├── SidebarFavorites.vue       # Favorites Section(复用 PageItem)
│       └── SidebarFooter.vue         # 快捷键提示
└── composables/
    ├── useSidebar.ts                 # 折叠状态(isCollapsed, toggle)
    ├── useRecent.ts                  # 最近页面(≤3,展开≤10)
    └── useFavorites.ts               # 收藏(add/remove,LocalStorage 持久化)
```

**PageItem.vue 共用策略:**
- Recent 和 Favorites 的 PageItem 样式完全一致
- 通过 `source` prop 区分('recent' | 'favorites')
- active 状态逻辑:比较 `pageStore.currentPageId === page.id`

---

## 状态汇总(v0.8)

| 状态 | 组件 | 样式 |
|------|------|------|
| Default | JournalCard | 背景 accent-subtle,圆角 8px |
| Hover | JournalCard | 背景 #FEF0C0,箭头右移 2px |
| Active | JournalCard | scale(0.98),80ms |
| Default | PageItem(Recent/Fav)| 无背景 |
| Hover | PageItem | 背景 --bg-hover |
| Active | PageItem | 左 2px accent,背景 --bg-active,字重 500 |
| Empty | Favorites | "暂无收藏" + "点击上方添加" |
| Default | AddFavorite | ☆ + "添加收藏",--text-tertiary |
| Hover | AddFavorite | 背景 --bg-hover,accent 色 |

---

## 与 v0.7 的差异

| 项目 | v0.7 | v0.8 |
|------|------|------|
| Journal | Section 内 Button | **Hero Card(80px)** |
| SearchBar | 独立 Zone(重复入口)| **删除** |
| Graph | 占位 Section | **删除** |
| Recent 上限 | 5 条 | **3 条** |
| Favorites 添加 | SectionLabel 右侧 [+] | **列表内 [+ 添加收藏]** |
| Footer hint | "斜杠命令 · Ctrl+K" | **"Ctrl+K · 命令与搜索"** |
| Section 总数 | 7 个 Zone | **5 个 Zone** |

---

## 与 Logseq 对照

| 功能 | Logseq | comind v0.8 | 差异 |
|------|--------|-------------|------|
| 搜索 | Ctrl+K 命令面板 | Ctrl+K 命令面板 | 一致 |
| 日记 | Journal 按钮 | **Journal Card** | comind 权重更高 |
| 页面列表 | 所有页面(可折叠)| 无 | **comind 更克制** |
| 最近 | Recent 列表 | Recent(≤3条)| comind 限制更严 |
| 收藏 | Favorites | Favorites | 一致 |
| 图谱 | Graph | 无 | comind 暂时不做 |

---

## 迁移路径

1. **删除** `Sidebar.vue` 中的页面列表渲染逻辑
2. **新建** `src/components/Sidebar/` 目录,按组件结构重写
3. **新增** `useRecent` composable(从 pageStore 派生,按 updatedAt 排序)
4. **新增** `useFavorites` composable(LocalStorage 持久化)
5. **新增** `useJournal` composable(openTodayJournal 逻辑)
6. **App.vue** 引用 `Sidebar/SidebarContainer.vue`,其余不变
7. **Sidebar 折叠功能**:App.vue 监听 `useSidebar().isCollapsed`,调整主内容区 margin

---

## Phase 2 预留

以下功能在 Phase 2 考虑,v0.8 预留结构:

- **Graph Section**:在 Favorites 下方新增 Section,初期占位
- **Recent 展开**:点击 [▼] 展开最多 10 条,超出提示"查看全部 →"
- **Favorites 排序**:用户可拖拽调整收藏顺序
- **Ctrl+K 集成**:`useCtrlK` composable 统一管理命令面板状态
