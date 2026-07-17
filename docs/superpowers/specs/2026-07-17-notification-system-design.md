# 通知系统设计（Notification System Design）

**日期**：2026-07-17
**状态**：设计完成，待用户审阅
**作者**：brainstorming session
**关联**：基于现有 date-ref / schedule / deadline 系统

---

## 0. 决策摘要

本设计经过 13 个核心决策点的 grill-me 式访谈确定：

| # | 决策点 | 选择 |
|---|---|---|
| Q1 | 平台范围 | 双平台 + 能力分级（Desktop 全功能，Web tab 打开时有效） |
| Q2 | 触发源 | Schedule + Deadline + Overdue 三类 |
| Q3 | 后台行为 | 前台+后台实时 + 关闭后重启补发 |
| Q4 | Lead time 模型 | 每通知可配置（5 档：0/5/15/30/60 分钟） |
| Q5 | 持久化模型 | 完整 notifications 表 + 状态机 + 30 天清理 |
| Q6 | Recurrence 处理 | 触发后自动推进 date-ref ISO |
| Q7 | 通知中心 UX | BellIcon + 下拉面板（位于右上角 PageMenuButton 左侧） |
| Q8 | Snooze | 预设时长（10m / 30m / 1h / 明天） |
| Q9 | 点击行为 | 导航到 block + 标记已读 |
| Q10 | 设置项 | 全局开关 + 按类型开关 + 静默时段 + Web 权限按钮 |
| Q11 | Lead time 存储 | 扩展 date-ref 语法 `{{kind:iso\|rec\|leadMinutes}}` |
| Q12 | 调度器架构 | 纯 TS（setInterval 60s） |
| Q13 | Overdue 重提醒 | 转入逾期时触发一次（不重复） |

**依赖解决**：「已完成」状态复用现有 `status` 属性（值 ∈ {Done, Canceled}），不新增字段。

---

## 1. 架构总览

### 1.1 组件关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        Vue 应用层 (TS)                          │
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────┐  ┌──────────────┐ │
│  │ DateTimePicker   │   │ NotificationBell │  │ Notification │ │
│  │ Panel (扩展)     │   │ (新增)           │  │ Toast (新增) │ │
│  │ + lead time 字段 │   │ + 未读徽章       │  │ + snooze btn │ │
│  └────────┬─────────┘   └────────┬─────────┘  └──────┬───────┘ │
│           │                      │                   │         │
│           ▼                      ▼                   ▼         │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │           NotificationStore (Pinia, 新增)                │ │
│  │  - notifications[] (响应式)                              │ │
│  │  - unreadCount                                           │ │
│  │  - actions: fire/markRead/dismiss/snooze                 │ │
│  └────────┬─────────────────────────────────┬───────────────┘ │
│           │                                 │                 │
│           ▼                                 ▼                 │
│  ┌──────────────────┐         ┌──────────────────────────┐   │
│  │ NotificationSvc  │ ◄────── │ Scheduler (新增)         │   │
│  │ (新增, TS)       │  查询   │ - setInterval(60s)        │   │
│  │ - create/fire    │         │ - checkAndFire()         │   │
│  │ - markRead/etc   │         │ - startup: 补发 missed   │   │
│  └────────┬─────────┘         └────────┬─────────────────┘   │
│           │                            │                       │
│           │                            ▼                       │
│           │              ┌──────────────────────────┐         │
│           │              │ DateRefIndex (已有)      │         │
│           │              │ - queryByDateRange       │         │
│           │              │ - queryOverdue           │         │
│           │              │ + leadMinutes 字段       │         │
│           │              └──────────────────────────┘         │
│           │                                                  │
└───────────┼──────────────────────────────────────────────────┘
            ▼
┌───────────────────────────────────────────────────────────────┐
│                    存储层 (Storage)                            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ notifications  │  │ block_props    │  │ blocks         │  │
│  │ (新表)         │  │ (status 等)    │  │ (date-ref 在   │  │
│  │                │  │                │  │  content 中)   │  │
│  └────────────────┘  └────────────────┘  └────────────────┘  │
│  Desktop: SQLite (Rust)  |  Web: IndexedDB (Dexie)           │
└───────────────────────────────────────────────────────────────┘
            │
            ▼ (Desktop only)
┌───────────────────────────────────────────────────────────────┐
│              OS 通知层 (Tauri)                                 │
│  tauri-plugin-notification (新增)                              │
│  - 发送 OS 原生通知                                            │
│  - 点击事件 → 触发深链导航                                     │
└───────────────────────────────────────────────────────────────┘
```

### 1.2 核心数据流

1. **创建**：DateTimePickerPanel → 写 date-ref（含 leadMinutes）到 block content
2. **调度**：Scheduler 每分钟查 DateRefIndex → 计算 `fire_time = iso - leadMinutes`
3. **触发**：`fire_time ≤ now` → NotificationSvc.create() 写 notifications 表 + 通知 UI
4. **呈现**：前台 → NotificationToast；后台 → OS 通知（Desktop） / 浏览器通知（Web）
5. **推进**：recurrence 触发后 → `calculateNextRecurrence()` → 更新 block content
6. **交互**：用户点击 → navigateToPage + activateBlock + markRead
7. **Snooze**：dismiss 当前 + 创建新 pending 通知（`fire_time = now + duration`）
8. **补发**：启动时扫描 `fire_time ≤ now` 且未通知的事件 → 批量触发

### 1.3 新增 vs 复用

**新增**：
- `NotificationStore` (Pinia)
- `NotificationService` (TS)
- `Scheduler` (setInterval)
- `NotificationBell.vue`（含 bell 图标 + 徽章 + dropdown）
- `NotificationToast.vue`
- `notifications` 表（SQLite + IndexedDB）
- `tauri-plugin-notification` (Rust + npm)

**复用 / 扩展**：
- `DateRefIndex`（扩展 leadMinutes 字段）
- `date-ref.ts`（扩展语法）
- `DateTimePickerPanel.vue`（加 lead 字段）
- `DateRefExtension.ts`（渲染 lead）
- `navigateToPage` / `activateBlock`
- `recurrence.calculateNextRecurrence`
- `SettingsModal.vue`（加通知设置 section）
- Storage Adapter（新增 notifications CRUD）

---

## 2. 数据模型

### 2.1 date-ref 语法扩展

**现有语法**（[date-ref.ts:29](file:///d:/comind/comind/src/utils/date-ref.ts#L29)）：
```
{{schedule:2026-07-15T14:00|weekly}}
{{deadline:2026-07-15}}
```

**扩展后语法**（新增可选第三段 leadMinutes，默认 0）：
```
{{schedule:2026-07-15T14:00|weekly|15}}     // 提前 15 分钟
{{schedule:2026-07-15T14:00|weekly}}        // 无 lead（默认 0）
{{schedule:2026-07-15T14:00}}               // 无 recurrence 无 lead
{{deadline:2026-07-15||60}}                 // 无 recurrence 但 lead 60 分钟（空段）
{{deadline:2026-07-15|none|0}}              // 显式全字段
```

**Regex 扩展**：
```typescript
// 旧: /\{\{(schedule|deadline):([^}|]+?)(?:\|([^}]+?))?\}\}/g
// 新: /\{\{(schedule|deadline):([^}|]+?)(?:\|([^}|]*))?(?:\|([^}]+?))?\}\}/g
//     第3段为 leadMinutes，仅在第2段存在时才匹配（用空字符串表示无 recurrence）
```

**DateRef 接口扩展**：
```typescript
export interface DateRef {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
  leadMinutes: number  // 新增，默认 0
}
```

**序列化规则**：
- `leadMinutes === 0` 且 `recurrence === 'none'` → `{{kind:iso}}`
- `leadMinutes === 0` 且 `recurrence !== 'none'` → `{{kind:iso|recurrence}}`
- `leadMinutes !== 0` 且 `recurrence === 'none'` → `{{kind:iso||leadMinutes}}`（空第二段）
- `leadMinutes !== 0` 且 `recurrence !== 'none'` → `{{kind:iso|recurrence|leadMinutes}}`

### 2.2 notifications 表

**SQLite Schema**（src-tauri/crates/comind-core/src/storage/sqlite.rs）：
```sql
CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  blockId     TEXT NOT NULL,
  pageId      TEXT NOT NULL,
  kind        TEXT NOT NULL,          -- 'schedule' | 'deadline' | 'overdue'
  eventIso    TEXT NOT NULL,          -- 触发此通知的事件 ISO
  firedAt     INTEGER NOT NULL,       -- 实际触发时间戳（ms）
  status      TEXT NOT NULL DEFAULT 'unread',  -- 'pending'|'unread'|'read'|'dismissed'
  snoozeUntil INTEGER,                -- 非 null 表示 snooze 中
  payload     TEXT NOT NULL,          -- JSON: { title, body, blockSnippet, eventDisplay }
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL,
  FOREIGN KEY (blockId) REFERENCES blocks(id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_firedAt ON notifications(firedAt);
CREATE INDEX idx_notifications_blockId ON notifications(blockId);
```

**IndexedDB Schema**（Dexie，src/core/storage/indexedDBAdapter.ts）：
```typescript
db.version(N).stores({
  notifications: 'id, blockId, pageId, kind, status, firedAt, snoozeUntil'
})
```

**状态机**：
```
pending ──(fire_time 到)──> unread ──(用户读)──> read ──(30天)──> 删除
                              │                  │
                              │                  └──(用户 dismiss)──> dismissed ──(30天)──> 删除
                              │
                              └──(用户 snooze)──> 创建新 pending (snoozeUntil=now+dur)
                                                 当前标记 dismissed
```

**注意**：`pending` 状态短期存在（snooze 创建后到 snoozeUntil 之间），调度器扫描 `pending` + `snoozeUntil ≤ now` 触发为 `unread`。

### 2.3 payload 结构

```typescript
interface NotificationPayload {
  title: string         // page 标题（如 "团队周会笔记"）
  body: string          // 格式化的事件时间 + block 内容片段
  blockSnippet: string  // block 内容前 50 字符（纯文本）
  eventDisplay: string  // "14:00" | "明天 09:00" | "已逾期 2 天"
}
```

### 2.4 通知设置存储

复用现有 `config.json` (Desktop) / `localStorage` (Web) 配置机制：

```typescript
interface NotificationSettings {
  enabled: boolean                       // 全局开关
  scheduleEnabled: boolean               // 按类型：schedule
  deadlineEnabled: boolean               // 按类型：deadline
  overdueEnabled: boolean                // 按类型：overdue
  quietHoursStart: string | null         // "22:00" 或 null
  quietHoursEnd: string | null           // "08:00" 或 null
  webBrowserNotificationsEnabled: boolean  // Web 浏览器通知授权状态
}
```

存入 `AppData\com.comind.app\config.json` 的 `notifications` 字段。

### 2.5 与现有系统的关系

- **block_properties 表**：不变。`status` 属性查询用于判断 overdue
- **blocks 表**：不变。date-ref 仍在 `content` 中
- **block_versions 表**：recurrence 自动推进会生成新版本（符合 G2 快照机制）
- **DateRefIndex**：扩展 `IndexEntry` 增加 `leadMinutes` 字段

---

## 3. 调度器逻辑

### 3.1 主循环

**位置**：`src/composables/useNotificationScheduler.ts`（新增），在 `App.vue` `onMounted` 启动，`onUnmounted` 清理。

```typescript
const CHECK_INTERVAL = 60_000  // 1 分钟

onMounted(async () => {
  await dateRefIndex.build()  // 确保索引完成
  await checkAndFire(true)    // 启动时立即跑一次（含补发）
  timer = setInterval(() => checkAndFire(false), CHECK_INTERVAL)
})

onUnmounted(() => clearInterval(timer))
```

### 3.2 checkAndFire 算法

```typescript
async function checkAndFire(isStartup: boolean = false) {
  const now = Date.now()
  const settings = getNotificationSettings()
  if (!settings.enabled) return

  const pendingTriggers: Trigger[] = []

  // 1. 收集所有 date-refs（schedule + deadline）
  const scheduleRefs = dateRefIndex.queryByDateRange('schedule', ANY, ANY)
  const deadlineRefs = dateRefIndex.queryByDateRange('deadline', ANY, ANY)

  // 2. 处理 schedule / deadline 触发
  for (const ref of [...scheduleRefs, ...deadlineRefs]) {
    const kindEnabled = ref.kind === 'schedule' ? settings.scheduleEnabled : settings.deadlineEnabled
    if (!kindEnabled) continue

    const block = await blockService.get(ref.blockId)
    if (!block) continue  // block 已删除

    const eventTime = parseIsoLocal(ref.iso)
    const fireTime = eventTime - ref.leadMinutes * 60_000
    if (fireTime > now) continue  // 未到时间

    // 去重：该 (blockId, kind, eventIso) 已通知过？
    const existing = await notificationService.findByEvent(ref.blockId, ref.kind, ref.iso)
    if (existing) continue

    pendingTriggers.push({ block, ref, kind: ref.kind })
  }

  // 3. 处理 overdue 触发
  if (settings.overdueEnabled) {
    const overdueRefs = dateRefIndex.queryOverdue()
    for (const ref of overdueRefs) {
      const block = await blockService.get(ref.blockId)
      if (!block) continue

      const status = await propertyService.get(block.id, 'status')
      if (status === 'Done' || status === 'Canceled') continue

      const existingOverdue = await notificationService.findByEvent(ref.blockId, 'overdue', ref.iso)
      if (existingOverdue) continue

      pendingTriggers.push({ block, ref, kind: 'overdue' })
    }
  }

  // 4. 触发通知（含启动轰炸防护）
  const inQuietHours = isInQuietHours(now, settings)
  if (isStartup && pendingTriggers.length > 5) {
    // 批量写入 DB，不弹 Toast
    await notificationService.batchCreate(pendingTriggers, { skipUiAlert: true })
    showStartupBanner(pendingTriggers.length)
  } else {
    for (const trigger of pendingTriggers) {
      await notificationService.create({
        blockId: trigger.block.id,
        pageId: trigger.block.pageId,
        kind: trigger.kind,
        eventIso: trigger.ref.iso,
        payload: buildPayload(trigger.block, trigger.ref),
        skipUiAlert: inQuietHours,
      })
    }
  }

  // 5. recurrence 自动推进
  for (const trigger of pendingTriggers) {
    if (trigger.ref.recurrence !== 'none' && trigger.kind !== 'overdue') {
      const nextIso = calculateNextRecurrence(trigger.ref.iso, trigger.ref.recurrence)
      await advanceDateRefInBlock(trigger.block, trigger.ref, nextIso)
    }
  }

  // 6. 处理 snooze 到期
  const snoozedReady = await notificationService.querySnoozedDue(now)
  for (const n of snoozedReady) {
    await notificationService.fireSnoozed(n.id)
  }
}
```

### 3.3 补发逻辑（Missed Reminders）

启动时 `checkAndFire(true)` 自然处理补发 —— 调度器查所有 date-refs，凡 `fire_time ≤ now` 且未通知的都会触发。关闭期间错过的事件，启动后第一次扫描即触发。

**避免启动轰炸**：
- 若错过通知 > 5 条，仅批量创建 DB 记录（status=unread），不弹 NotificationToast
- 在 BellDropdown 顶部显示「关闭期间有 N 条提醒」横幅

### 3.4 recurrence 自动推进

```typescript
async function advanceDateRefInBlock(block: Block, ref: DateRef, nextIso: string) {
  try {
    const oldSyntax = serializeDateRef(ref)
    const newRef = { ...ref, iso: nextIso }
    const newSyntax = serializeDateRef(newRef)
    const newContent = block.content.replace(oldSyntax, newSyntax)
    if (newContent === block.content) {
      logger.warn('date-ref advance failed: content mismatch', { blockId: block.id })
      return
    }
    await blockService.update(block.id, { content: newContent })
    // 触发 block version 历史（G2 快照机制自动处理）
    // 触发 DateRefIndex.update() 重新索引
  } catch (e) {
    logger.error('date-ref advance error', e)
    // 不阻塞通知流程，下次调度周期重试
  }
}
```

**注意**：replace 用字符串精确匹配。一个 block 可有多个 date-ref（一个 schedule + 一个 deadline），需逐个替换。

### 3.5 静默时段判断

```typescript
function isInQuietHours(nowMs: number, settings: NotificationSettings): boolean {
  if (!settings.quietHoursStart || !settings.quietHoursEnd) return false
  const now = new Date(nowMs)
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const start = settings.quietHoursStart  // "22:00"
  const end = settings.quietHoursEnd      // "08:00"
  // 跨夜判断：start > end 表示跨夜（如 22:00-08:00）
  if (start <= end) {
    return hhmm >= start && hhmm < end
  } else {
    return hhmm >= start || hhmm < end
  }
}
```

### 3.6 fire_time 计算

```typescript
function computeFireTime(eventIso: string, leadMinutes: number): number {
  const m = eventIso.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/)
  if (!m) return Number.MAX_SAFE_INTEGER
  const [_, y, mo, d, h, mi] = m
  const date = new Date(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0)
  return date.getTime() - leadMinutes * 60_000
}
```

### 3.7 关键不变量

- **去重**：`(blockId, kind, eventIso)` 三元组唯一标识一次通知事件，已存在则跳过
- **完成态短路**：overdue 检查时 `status ∈ {Done, Canceled}` 直接跳过
- **block 删除级联**：notification 表 `ON DELETE CASCADE`
- **advance 原子性**：recurrence 推进需在通知创建之后（避免推进后原 ISO 找不到）

---

## 4. UI 组件设计

### 4.1 NotificationBell（新增组件）

**位置**：`src/components/NotificationBell.vue`

**布局**：在 [App.vue L250 的 `.top-right-controls`](file:///d:/comind/comind/src/App.vue#L250-L251) 内，`<PageMenuButton />` 之前插入。

```vue
<div class="top-right-controls">
  <NotificationBell />     <!-- 新增 -->
  <PageMenuButton />
  <button class="right-sidebar-toggle" ... />
  <div class="window-controls" v-if="isTauriEnvironment()">...</div>
</div>
```

**组件内容**：
- Bell 图标按钮（含未读数红色徽章）
- 点击展开下拉面板（280px 宽，右对齐到铃铛）
- 下拉面板结构：
  - 顶部：「通知 (N)」 + 「全部标为已读」按钮
  - 列表项：左侧色条（蓝=schedule / 红=overdue / 橙=deadline）+ 标题 + 时间 + block 内容片段 + snooze 按钮
  - 空状态：「无新通知」
  - 启动补发横幅：「关闭期间有 N 条提醒」（条件显示）
- 点击外部关闭下拉

**交互**：
- 列表项点击（非按钮区域）：navigateToPage + activateBlock + markRead
- 每个列表项含 inline 4 个 snooze 按钮 + 1 个 dismiss 按钮（10m / 30m / 1h / 明天 / ✕）
- 「全部标为已读」按钮：批量更新 unread → read

**「明天」snooze 的定义**：fire_time = 次日 09:00

### 4.2 NotificationToast（新增组件）

**位置**：`src/components/NotificationToast.vue`

**触发**：NotificationService.create() 时若非静默时段且 app focused

**与现有 Toast 区别**：
- 无自动消失（持续到用户操作）
- 含操作按钮：「查看」「⏱ 10m」「⏱ 30m」「⏱ 1h」「⏱ 明天」「✕」（与 BellDropdown 一致的 4 个 snooze 预设 + 查看 + dismiss）
- 富文本结构（标题 + 时间 + 片段）

**布局**：右上角固定定位（top: 70px, right: 20px），多个堆叠（最多 3 个，超出转入 BellDropdown）

**交互**：
- 点击「查看」：navigateToBlock + markRead + 关闭 toast
- 点击 snooze 按钮（10m/30m/1h/明天）：创建新 pending（fire_time = now + duration）+ dismiss 当前 + 关闭 toast
- 点击 ✕：dismiss + 关闭 toast

**「明天」的定义**：fire_time = 次日 09:00（如当前为 14:00，则次日 09:00 重新触发）

### 4.3 DateTimePickerPanel 扩展

**修改文件**：[DateTimePickerPanel.vue](file:///d:/comind/comind/src/components/DateTimePickerPanel.vue)

**变更**：在「重复」选择器下方新增「提前提醒」select

- 选项：准时（0 分钟）/ 5 分钟前 / 15 分钟前 / 30 分钟前 / 1 小时前
- 默认值：0（准时）
- 确定时序列化为 `{{kind:iso|recurrence|leadMinutes}}`

### 4.4 SettingsModal 扩展

**修改文件**：[SettingsModal.vue](file:///d:/comind/comind/src/components/Settings/SettingsModal.vue)

**变更**：新增「通知」分区（与「通用/数据管理/外观」并列 tab）

包含：
- 全局开关（toggle）
- 按类型开关（3 个 sub-toggle：schedule / deadline / overdue，全局开关关时禁用）
- 静默时段（两个 time input + 说明文案「此段内仅写入通知中心，不弹窗」）
- 浏览器通知权限按钮（仅 Web 显示，调用 `Notification.requestPermission()`）

---

## 5. 平台特定行为

### 5.1 Desktop (Tauri) 行为

**新增依赖**：
- Rust: `tauri-plugin-notification = "2"` (添加到 [Cargo.toml](file:///d:/comind/comind/src-tauri/Cargo.toml))
- npm: `@tauri-apps/plugin-notification` (添加到 [package.json](file:///d:/comind/comind/package.json))
- Rust main.rs: `tauri::Builder::default().plugin(tauri_plugin_notification::init())`
- Capabilities: [default.json](file:///d:/comind/comind/src-tauri/capabilities/default.json) 增加 `"notification:default"` 和 `"notification:allow-notify"`

**通知触发**：
- 前台（window focused）：NotificationToast + OS 通知（默认两者都弹）
- 后台（window minimized/hidden）：仅 OS 通知
- 关闭：不触发，启动时补发

**OS 通知点击深链**：
```typescript
import { listen } from '@tauri-apps/api/event'
listen('notification-click', (event) => {
  const { blockId, pageId, notificationId } = event.payload
  navigateToPage(pageId)
  activateBlock(blockId)
  markRead(notificationId)
})
```

Rust 端在发送通知时携带 payload，点击事件回传到 JS。

### 5.2 Web 行为

**通知触发**：
- 前台（tab focused）：NotificationToast（无浏览器通知，避免打扰）
- Tab 后台（tab hidden）：浏览器通知（需用户在 Settings 主动授权 `Notification.requestPermission()`）
- Tab 关闭：不触发，启动时补发

**浏览器通知 API**：
```typescript
async function showBrowserNotification(payload: NotificationPayload) {
  if (Notification.permission !== 'granted') return
  const notif = new Notification(payload.title, {
    body: payload.body,
    icon: '/favicon.svg',
    tag: payload.blockId  // 同 block 多次通知只保留最新
  })
  notif.onclick = () => {
    window.focus()
    navigateToBlock(payload)
    markRead(notificationId)
  }
}
```

**无需 Service Worker**：浏览器通知在 tab 关闭后无法触发，但 tab 后台时仍可触发（无需 SW）。Service Worker + Push API 需要后端，超出范围。

### 5.3 平台检测与统一 API

```typescript
// src/services/notification-delivery.ts
interface NotificationDelivery {
  show(payload: NotificationPayload, blockId: string): Promise<void>
}

class TauriDelivery implements NotificationDelivery { /* OS 通知 */ }
class WebDelivery implements NotificationDelivery { /* 浏览器通知 */ }
class InAppOnlyDelivery implements NotificationDelivery { /* 仅 toast */ }

function getDelivery(): NotificationDelivery {
  if (isTauri()) return new TauriDelivery()
  if (isWeb() && Notification?.permission === 'granted') return new WebDelivery()
  return new InAppOnlyDelivery()
}
```

### 5.4 能力分级对照

| 场景 | Desktop 前台 | Desktop 最小化 | Desktop 关闭 | Web 前台 | Web tab 后台 | Web tab 关闭 |
|---|---|---|---|---|---|---|
| Toast | ✅ | ❌ | N/A | ✅ | ❌ | N/A |
| OS/浏览器通知 | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| 写入通知中心 | ✅ | ✅ | 启动补发 | ✅ | ✅ | 启动补发 |
| 点击导航 | ✅ | ✅（聚焦窗口） | N/A | ✅ | ✅（聚焦 tab） | N/A |

### 5.5 静默时段平台无关

静默时段判断在 TS 层（`isInQuietHours`），两个平台一致行为：写 DB 但不弹 Toast / OS 通知。

---

## 6. 错误处理与边缘情况

### 6.1 数据完整性

| 场景 | 处理 |
|---|---|
| Block 被删除 | `notifications.blockId` 外键 `ON DELETE CASCADE`，通知自动删除 |
| Block content 中的 date-ref 被手动删除 | 调度器查 `dateRefIndex` 自然跳过；孤儿通知记录在 BellDropdown 显示「block 已删除」并允许用户 dismiss |
| Block content 中的 date-ref 被手动修改（ISO 变更） | 旧 ISO 通知记录保留（已触发）；新 ISO 重新计算 fire_time；`(blockId, kind, eventIso)` 去重天然处理 |
| `status` 属性从 `Done` 回退到 `Todo` | 调度器下次扫描时若 deadline 仍过期，检查去重：若 eventIso 已存在 dismissed 记录则允许重新创建 unread |
| DateRefIndex 未构建完成时调度器启动 | `App.vue` 中 `await dateRefIndex.build()` 完成后再启动调度器（启动顺序保证） |

### 6.2 recurrence 推进失败

```typescript
async function advanceDateRefInBlock(block, ref, nextIso) {
  try {
    const newContent = block.content.replace(oldSyntax, newSyntax)
    if (newContent === block.content) {
      logger.warn('date-ref advance failed: content mismatch', { blockId: block.id })
      return
    }
    await blockService.update(block.id, { content: newContent })
  } catch (e) {
    logger.error('date-ref advance error', e)
    // 不阻塞通知流程，下次调度周期重试
  }
}
```

### 6.3 通知权限被拒绝

- Web：`Notification.permission === 'denied'` → Settings 中按钮显示「已拒绝」，提示用户在浏览器设置中恢复
- Desktop：Tauri notification 失败时降级为仅 Toast / 仅写入通知中心

### 6.4 调度器节流问题

Web tab 后台时 `setInterval` 可能被节流到 1 分钟以上。影响：
- 通知延迟几分钟（可接受）
- 启动补发逻辑捕获所有错过的事件（兜底）

不引入 Rust 调度器作为 MVP，但代码结构预留升级路径（`NotificationDelivery` 接口可替换为 Rust 实现）。

### 6.5 启动轰炸防护

```typescript
if (isStartup && pendingTriggers.length > 5) {
  await notificationService.batchCreate(pendingTriggers, { skipUiAlert: true })
  showStartupBanner(pendingTriggers.length)
} else {
  // 正常逐条 create
}
```

### 6.6 多 tab 同步（Web）

Web 多 tab 打开同一应用：IndexedDB 共享，但两个调度器都会运行 → 可能重复触发。

**方案**：使用 Web Locks API (`navigator.locks`) 确保仅一个 tab 运行调度器
```typescript
navigator.locks.request('comind-notification-scheduler', { mode: 'exclusive' }, (lock) => {
  if (!lock) return  // 其他 tab 已持有锁，本 tab 不启动调度器
  startScheduler()
  return new Promise(() => {})  // 持有锁直到 tab 关闭
})
```

Desktop 单窗口运行，无此问题。

---

## 7. 测试策略

遵循项目混合测试策略（[compilation-check.md](file:///d:/comind/.trae/rules/compilation-check.md)）：Vitest 单元测试 + Playwright E2E + 浏览器自动化验证。

### 7.1 单元测试（Vitest）

**位置**：`src/__tests__/` 或与源文件同目录 `.test.ts`

| 测试文件 | 覆盖范围 |
|---|---|
| `date-ref.test.ts`（扩展） | 新语法解析：`{{schedule:ISO\|rec\|lead}}`、`{{schedule:ISO\|\|lead}}`、向后兼容旧语法 |
| `recurrence.test.ts`（已有） | calculateNextRecurrence 不变（无修改） |
| `notification-service.test.ts`（新增） | create / markRead / dismiss / snooze / findByEvent / querySnoozedDue |
| `notification-scheduler.test.ts`（新增） | checkAndFire 算法、fire_time 计算、去重、recurrence 推进、overdue 检测、静默时段判断、启动轰炸防护 |
| `quiet-hours.test.ts`（新增） | 跨夜/非跨夜时段判断、边界值（00:00 / 23:59） |
| `notification-store.test.ts`（新增） | Pinia store 状态机：pending → unread → read/dismissed |
| `date-ref-index.test.ts`（扩展） | IndexEntry 含 leadMinutes 字段 |

**关键测试用例**：
```typescript
describe('checkAndFire', () => {
  it('未到 fire_time 时不触发', async () => { ... })
  it('fire_time ≤ now 且未通知过 → 触发', async () => { ... })
  it('已通知过的事件不重复触发', async () => { ... })
  it('recurrence 触发后 ISO 自动推进', async () => { ... })
  it('status=Done 的 deadline 不触发 overdue', async () => { ... })
  it('静默时段内仅写 DB 不弹 Toast', async () => { ... })
  it('启动时 > 5 条补发 → 批量写 DB + 横幅', async () => { ... })
  it('snoozeUntil ≤ now 的 pending 通知重新触发', async () => { ... })
})

describe('date-ref 语法扩展', () => {
  it('解析 {{schedule:ISO|weekly|15}}', () => { ... })
  it('解析 {{schedule:ISO||30}} (空 recurrence)', () => { ... })
  it('解析 {{schedule:ISO}} 向后兼容 (默认 lead=0)', () => { ... })
  it('序列化 lead=0 时不输出第三段', () => { ... })
  it('序列化 lead>0 + recurrence=none 用空第二段', () => { ... })
})
```

### 7.2 E2E 测试（Playwright）

**位置**：`tests/notifications.spec.ts`（新增）

| 测试场景 | 步骤 |
|---|---|
| 创建带 lead time 的 schedule | DateTimePickerPanel 选 15 分钟前 → 验证 block content 含 `\|15` |
| 通知触发并显示 Toast | 模拟时间推进 → 验证 NotificationToast 出现 |
| 点击 Toast「查看」导航到 block | 点击 → 验证 URL 含 pageId + block 激活 |
| Snooze 创建新 pending | 点击 ⏱ 10m → 验证 BellDropdown 数量 -1，10 分钟后再 +1 |
| BellDropdown 展开/关闭 | 点击铃铛 → 验证下拉显示 → 点击外部 → 关闭 |
| 全部标为已读 | 点击按钮 → 验证徽章消失 |
| Settings 静默时段设置 | 设置 22:00-08:00 → 模拟 23:00 触发 → 验证仅写 DB 不弹 Toast |
| 启动补发 | 关闭 app → 模拟时间过去 1 小时 → 重启 → 验证补发横幅显示 |
| Web 浏览器通知授权 | Settings 点击授权 → 验证 Notification.permission === 'granted' |

### 7.3 浏览器自动化验证（webapp-testing 技能）

- 关键页面截图：BellDropdown 展开状态、NotificationToast 弹出状态、Settings 通知分区
- 浏览器日志无错误
- 暗色/浅色主题下通知 UI 都正常

### 7.4 编译检查清单

按 [compilation-check.md](file:///d:/comind/.trae/rules/compilation-check.md)：
- `npm run build` 通过（vue-tsc + vite build）
- `npm run test` 全部通过
- `npm run test:e2e` 全部通过
- `npm run tauri:build` Desktop 构建通过（含 tauri-plugin-notification）
- 浏览器日志无错误
- UI 行为调试无异常

### 7.5 测试覆盖目标

- 核心调度逻辑：≥ 90%
- date-ref 语法扩展：100%（向后兼容关键）
- UI 组件交互：≥ 80%
- 平台特定 delivery：手动验证 + smoke test

---

## 8. 实施范围（Out of Scope）

以下功能**不在本次设计范围**，留作未来扩展：

- 多提醒 per event（如 1 天前 + 1 小时前 + 5 分钟前）
- 自定义 snooze（datetime picker）
- Rust 后台调度器（解决 webview throttling）
- OS 任务计划程序集成（关闭 app 也能触发）
- Web Service Worker + Push API（需后端服务器）
- 通知分组（按 page / 按 kind 折叠）
- 通知声音 / 振动
- 邮件 / 第三方应用推送（Slack/钉钉等）

---

## 9. 文件清单

### 9.1 新增文件

| 路径 | 用途 |
|---|---|
| `src/components/NotificationBell.vue` | 铃铛 + 下拉面板 |
| `src/components/NotificationToast.vue` | 实时通知弹窗 |
| `src/composables/useNotificationScheduler.ts` | 调度器 |
| `src/services/notification-service.ts` | 通知 CRUD 服务 |
| `src/services/notification-delivery.ts` | 平台 delivery 抽象 |
| `src/stores/notification.ts` | Pinia store |
| `src/utils/quiet-hours.ts` | 静默时段判断 |
| `src/types/notification.ts` | 类型定义 |
| `tests/notifications.spec.ts` | E2E 测试 |
| 多个 `.test.ts` 文件 | 单元测试 |

### 9.2 修改文件

| 路径 | 变更 |
|---|---|
| `src/utils/date-ref.ts` | 扩展 regex + DateRef.leadMinutes + serialize/parse |
| `src/storage/date-ref-index.ts` | IndexEntry 加 leadMinutes |
| `src/components/DateTimePickerPanel.vue` | 加 lead time select |
| `src/extensions/DateRefExtension.ts` | 渲染 lead time（可选） |
| `src/composables/useContentRenderer.ts` | reading state 渲染 lead（可选） |
| `src/components/Settings/SettingsModal.vue` | 加通知设置 section |
| `src/App.vue` | 插入 `<NotificationBell />` + 启动调度器 |
| `src/core/storage/adapter.ts` | 加 notifications CRUD 接口 |
| `src/core/storage/indexedDBAdapter.ts` | 实现 notifications CRUD |
| `src-tauri/crates/comind-core/src/storage/sqlite.rs` | 加 notifications 表 + CRUD |
| `src-tauri/crates/comind-core/src/storage/repository.rs` | 加 notifications 方法 |
| `src-tauri/src/commands.rs` | 加 notification Tauri commands |
| `src-tauri/src/main.rs` | 注册 tauri-plugin-notification |
| `src-tauri/Cargo.toml` | 加 tauri-plugin-notification 依赖 |
| `src-tauri/capabilities/default.json` | 加 notification 权限 |
| `package.json` | 加 @tauri-apps/plugin-notification |
| `src/wasm/client.ts` 等 | 加 notifications client 方法 |

---

## 10. 设计自检

- ✅ 无 TBD / TODO / 占位符
- ✅ 各节内部一致：架构 ↔ 数据模型 ↔ 调度器 ↔ UI ↔ 平台 ↔ 错误处理 ↔ 测试
- ✅ 范围聚焦：单一 spec 可实施，未尝试覆盖多提醒 / Rust 调度器 / Push API
- ✅ 无歧义：每项需求均有明确行为定义，关键不变量列明
