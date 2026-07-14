# /date、/schedule、/deadline 斜杠命令重新设计方案（v2 · inline 节点方案）

> 本版相对 v1 的核心变更：日期从「Block 外部属性」改为「Block.content 内的 inline 文本节点」。
> 决策依据：日期是内容的语义组成部分（C），且需可点击直接编辑（D）。status/priority 等 workflow 属性保留为外部属性。

---

## 一、核心决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 日期存储位置 | **Block.content 内**（inline 文本） | 日期是语义内容，不是外部标签 |
| status/priority 存储 | **Block.properties 外部属性** | 工作状态/判断是元数据，非内容 |
| content 数据形态 | 纯文本字符串（现有形态，不变） | `Block.content: string`，日期存为专用语法 |
| 渲染方式 | 复用 WikiLink 模式（Decoration + useContentRenderer） | 与现有代码一致，无需自定义 PM 节点 |
| 交互 | 点击日期 span → 弹出 DateTimePickerPanel → 改写 content 文本 | 满足「点一下直接改」（D） |
| /date 语义 | 插入 WikiLink 页面链接 `[[YYYY-MM-DD]]` | 指向 journal 页面，与 schedule/deadline 区分 |
| /schedule、/deadline 语义 | 插入 dateRef 语法 `{{kind:ISO|recurrence}}` | inline 日期节点 |

---

## 二、存储格式与语法

### 现有事实（已验证）
- `Block.content` 是 `string`（见 `src/types/block.ts`）
- WikiLink 存为 `[[page]]` 文本，编辑态由 `WikiLinkExtension` 用 ProseMirror Decoration 渲染为可点击 span，阅读态由 `useContentRenderer.ts` 渲染为 HTML span
- 系统已有 typed-link 约定 `((type))[[target]]`（关系类型），证明「文本语法 + 渲染层装饰」是本项目成熟模式

### 日期语法定义

| 场景 | content 中文本 | 说明 |
|------|---------------|------|
| /date 插入 | `[[2026-07-15]]` | 普通 WikiLink，指向 journal 页面（沿用现有行为） |
| /schedule | `{{schedule:2026-07-15T14:00}}` | scheduled 日期+时间 |
| /schedule 仅日期 | `{{schedule:2026-07-15}}` | 无时间默认为全天 |
| /deadline | `{{deadline:2026-07-17T18:00|weekly}}` | deadline + 重复规则 |
| /deadline 无重复 | `{{deadline:2026-07-17T18:00}}` | recurrence 缺省为 none |

**语法规则：**
- 格式：`{{<kind>:<ISO本地时间>|<recurrence>?}}`
- `kind` ∈ `schedule` | `deadline`
- ISO 本地时间：`2026-07-15T14:00`（不带时区后缀 Z，沿用 v1 时区决策）
- `recurrence` 借用 WikiLink 的 `|alias` 槽位，可选值 `none`/`daily`/`weekly`/`monthly`/`yearly`，缺省 `none`
- 解析时先匹配 `^{{(schedule|deadline):` 前缀，与普通 WikiLink（`[[page]]`）和关系 typed-link（`((type))[[target]]`）无冲突
- ⚠️ 框架约束：content 经 `useContentRenderer → v-html` 渲染，**禁止用 Vue `{{ }}` 直接绑定原始 content**（否则 `{{schedule:...}}` 会被当模板插值解析）；此约束写入编码规范

### 互斥与共存
- 一个 block 可同时含多个 dateRef（如既 scheduled 又 deadline），各自独立
- 多个同 kind dateRef（如两个 deadline）允许存在，索引层取首个为 canonical，其余保留
- /date 的 `[[page]]` 与 dateRef 共存无碍：前者是页面引用，后者是时间节点

---

## 三、命令定义

### 废弃命令（已合并到 /date）
| 废弃命令 | 原功能 | 迁移路径 |
|---------|--------|---------|
| `/today` | 插入 `[[今天]]` | → `/date today` 或 `/date` |
| `/tomorrow` | 插入 `[[明天]]` | → `/date tomorrow` |
| `/yesterday` | 插入 `[[昨天]]` | → `/date yesterday` |

**保留命令：**
| 命令 | 功能 | 插入内容 |
|------|------|---------|
| `/date` | 日期页面链接 | `[[YYYY-MM-DD]]`（WikiLink） |
| `/schedule` | 计划日期节点 | `{{schedule:ISO}}` |
| `/deadline` | 截止日期节点 | `{{deadline:ISO|recurrence}}` |
| `/time` | 当前时间文本 | `HH:mm`（独立语义，保留） |

---

## 四、渲染架构

### 编辑态（ProseMirror Decoration）
新增 `DateRefExtension`（仿 `WikiLinkExtension`）：
- 正则匹配 `\{\{(schedule|deadline):[^\}|]+(?:\|[^\}]+)?\}\}` 文本节点
- 用 `Decoration.inline` 包裹为 `<span class="date-ref" data-kind data-iso data-recurrence>`
- 显示：📅（schedule）/ ⏰（deadline，逾期变红）+ 智能格式化文本 + 重复标记
- 点击 span → 打开 DateTimePickerPanel（mode 由 kind 决定）→ 确认后改写 content 对应文本区间

### 阅读态（HTML 渲染）
扩展 `useContentRenderer.ts` 的渲染流水线，新增 dateRef 分支（仿 `renderTypedLinks`）：
- 将 `{{schedule:...}}` / `{{deadline:...}}` 渲染为带 `data-kind` / `data-iso` 的 span
- 支持点击交互（与编辑态共用 DateRefExtension 的点击逻辑或轻量事件）

### 交互闭环
```
用户点击 dateRef span
  → 读取 data-kind / data-iso / data-recurrence
  → 打开 DateTimePickerPanel(mode=kind==='deadline'?'datetime':'datetime')
  → 用户改日期/时间/重复
  → editor.commands 改写 content 中该文本区间
  → Decoration 自动重渲染（ProseMirror tr.mapping）
```

---

## 五、参数解析（沿用 v1 扩展）

`src/utils/date-parser.ts` 扩展，支持日期+时间：
- `/schedule 明天 14:00` → `2026-07-16T14:00`
- `/deadline 2026-07-13 9:30` → `2026-07-13T09:30`
- `/deadline 明天下午2点` → `2026-07-16T14:00`

解析顺序：日期部分（today/tomorrow/yesterday/+N/-N/MM-DD/YYYY-MM-DD）→ 时间部分（HH:mm 或中文"下午2点"）→ 无时间默认 `00:00`（全天）。

---

## 六、重复规则与自动推进（重写）

### recurrence 跟随 dateRef
recurrence 不再是独立属性，而是 dateRef 语法的一部分（`|weekly`），随日期节点一起存在 content 中。

### 自动推进（Done 语义）
当一个带 recurrence 的任务被标记 Done 时：
1. 遍历 Block.content，定位该 block 的 dateRef 文本节点
2. 解析 ISO → `calculateNextRecurrence(date, recurrence)`
3. 将 content 中该 dateRef 文本替换为新日期
4. status 重置为 Todo（status 是外部属性，走现有 propertyStore）

```typescript
// 伪代码：在 content 文本层操作，不改 properties
function advanceDateRefInContent(content: string, recurrence: string): string {
  return content.replace(
    /\{\{(schedule|deadline):([^\}|]+)(?:\|([^\}]+))?\}\}/g,
    (full, kind, iso, rec) => {
      if (!rec || rec === 'none' || rec !== recurrence) return full
      const next = calculateNextRecurrence(iso, rec)
      return `{{${kind}:${next}|${rec}}}`
    }
  )
}
```

### 重复日期计算
- daily：+1 天
- weekly：+7 天
- monthly：+1 月（月末自动调整）
- yearly：+1 年（2/29 在非闰年归到 2/28）

---

## 七、索引与查询（新增）

现有系统已对 WikiLink（页面引用）和 relationship（typed-link）建立索引以支持查询/清理（`useBlockRelationshipCleanup.ts`）。dateRef 需建立同类索引：

- **DateRef 索引**：从每个 block 的 content 提取所有 `{{kind:ISO|recurrence}}`，建立 `(blockId, kind, date)` 映射
- **用途**：日历视图、「本周截止任务」过滤、按日期排序
- **维护时机**：content 变更时增量更新（仿现有 link 索引的更新路径）
- **注意**：dateRef 在 content 中，索引是派生数据，canonical 源仍是 content 文本

---

## 八、组件架构

### DateTimePickerPanel.vue（多模式，沿用 v1）
- `mode: 'date' | 'datetime'`
- `/date` 用 date 模式输出 WikiLink；`/schedule`、`/deadline` 用 datetime 模式输出 dateRef 语法
- 预设时间下拉、重复规则下拉（仅 datetime 模式）

### 新增 / 修改文件
| 文件 | 类型 | 说明 |
|------|------|------|
| `src/extensions/DateRefExtension.ts` | 新增 | 编辑态 Decoration 渲染 + 点击交互 |
| `src/composables/useContentRenderer.ts` | 修改 | 阅读态渲染 dateRef |
| `src/utils/date-parser.ts` | 修改 | 扩展日期+时间解析 |
| `src/utils/recurrence.ts` | 新增 | calculateNextRecurrence |
| `src/services/date-ref-index.ts` | 新增 | dateRef 索引（仿 link/relationship 索引） |
| `src/composables/useSlashCommands.ts` | 修改 | /date→WikiLink；/schedule、/deadline→dateRef；废弃 today/tomorrow/yesterday |
| `src/components/SlashCommandMenu.vue` | 修改 | 命令执行逻辑 |
| `src/stores/editor.ts` | 修改 | DateTimePickerPanel 状态（已是 v1 计划） |
| `src/stores/property.ts` | 修改 | 移除 deadline/scheduled/recurrence 外部属性逻辑；保留 status/priority |
| `src/components/DateTimePickerPanel.vue` | 新增 | 日期时间选择器面板 |
| `src/components/App.vue` | 修改 | 引入 DateTimePickerPanel |

### 不再需要（相对 v1）
- `PropertyInline.vue` / `PropertyDisplay.vue` 中 deadline/scheduled/recurrence 的显示逻辑 → 移至 DateRefExtension + useContentRenderer
- `src/types/property.ts` 中 deadline/scheduled 的 `datetime` 类型定义 → 删除（日期不再走属性系统）

---

## 九、设计决策总结

| 决策项 | 方案 |
|--------|------|
| 日期存储 | Block.content 内 inline 文本（选项 A） |
| 动机 | 语义内容（C）+ 可点击编辑（D） |
| status/priority | 外部属性（留外部） |
| content 形态 | 纯文本字符串（不变） |
| 渲染 | 复用 WikiLink Decoration + useContentRenderer 模式 |
| 日期语法 | `{{kind:ISO|recurrence}}` |
| /date | WikiLink 页面链接 `[[YYYY-MM-DD]]` |
| /schedule、/deadline | dateRef 语法 |
| 冗余命令 | 废弃 today/tomorrow/yesterday，合并到 /date |
| 时区 | 本地时间，不带 Z 后缀 |
| recurrence | 跟随 dateRef（`\|weekly`），非独立属性 |
| 自动推进 | 遍历 content 改写 dateRef 文本 + status 重置 |
| 索引 | 新增 dateRef 索引（仿现有 link/relationship 索引） |
| 日历组件 | 第三方库（v-calendar / element-plus） |

---

## 十、示例

### 示例 1：设置截止日期（带时间和重复）
```
输入：/deadline 明天 14:00 每周
content：... {{deadline:2026-07-16T14:00|weekly}} ...
渲染：... ⏰ 07-16 14:00 · 每周 ...
```

### 示例 2：设置计划日期（仅日期）
```
输入：/schedule 下周一
content：... {{schedule:2026-07-20}} ...
渲染：... 📅 07-20 ...
```

### 示例 3：插入日期页面链接
```
输入：/date
content：... [[2026-07-15]] ...   （WikiLink，指向 journal 页面）
```

### 示例 4：自动推进
```
初始：• 周报 {{deadline:2026-07-17T18:00|weekly}}   status=Done
推进：• 周报 {{deadline:2026-07-24T18:00|weekly}}   status=Todo
```
