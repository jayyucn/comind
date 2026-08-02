# 设计方案审核报告

## 审核信息

- **设计方案**：任务系统与通用 Block 筛选系统
- **审核时间**：2026-08-02 17:23 GMT+8
- **审核维度**：一致性、可行性、完整性、用户体验
- **设计方案类型**：技术架构 + 产品功能
- **Spec 文件**：`docs/superpowers/specs/2026-08-02-task-filter-system-design.md`

---

## 总体评价

方案整体思路清晰，分层合理（数据层→引擎层→持久化层→视图层），"筛选系统为基础层、任务中心为消费层"的泛化定位准确。已对照代码验证了所有关键假设（属性类型、BUILT_IN_PROPERTIES、client.ts 绑定模式、SQLiteAdapter/SqlJsAdapter 表结构、路由配置、侧栏组件结构），spec 与代码基本对齐。存在 3 个高优问题需修复后方可进入实施。

**总体评分**：7.5/10

---

## 详细分析

### 1. 一致性 ⚠️

**检查结果：**

- ✅ `PropertyType` 代码确认为 `string|number|boolean|date|array|page`，spec 以代码为准（非 property-spec.md 的含 `datetime` 版本），正确
- ✅ `BUILT_IN_PROPERTIES` 代码确认 `status`/`priority`/`project`/`area` 四个内置属性，spec 引用一致
- ✅ `client.ts` 方法命名模式（`getXxx` / `queryXxx`）与 spec 新增 `getBlockCards()` 命名一致
- ✅ `SQLiteAdapter`（`sqlite.rs`）和 `SqlJsAdapter`（`sqljs.rs`）的 `CREATE TABLE` 语句确认存在 `Property`、`DateRef`、`Notification` 等表，spec 声称复用这些表正确
- ✅ 路由模式（`routes.ts` 中 `graph`、`trash` 等独立页面路由）与 spec 新增任务中心路由模式一致
- ✅ 侧栏组件（`SidebarContainer.vue`）确认有 `SidebarGraphItem` 等常驻项，新增「✅ 任务」常驻项的模式与现有一致
- ⚠️ **spec §2.1 写 `useTaskQuery.ts`，但 §4.1 的类型文件是 `src/types/blockQuery.ts`**——文件命名不完全匹配。`useTaskQuery` 这个名字带有"任务"语义，但筛选系统是通用的，命名有矛盾
- ⚠️ **spec §2.1 写 `src/stores/blockCard.ts`，但 §3.2 写 `src/wasm/client.ts` 新增 `getBlockCards()`**——store 和 client 方法命名用了 `BlockCard` vs `Block`，需统一术语

**发现的问题：**

1. 引擎文件名 `useTaskQuery.ts` 与"通用筛选系统"定位矛盾——应改为 `useBlockQuery.ts` 或 `blockQueryEngine.ts`
2. `BlockCard` vs `Block` 术语混用——spec 里 `get_blocks_projection()` 返回 `BlockCard`，但 client 方法叫 `getBlockCards()`，store 叫 `blockCard.ts`。建议统一为 `BlockCard`（区分轻量投影与完整 Block 模型），但需在 spec 里明确声明这个术语选择

---

### 2. 可行性 ⚠️

**检查结果：**

- ✅ 纯函数 `applyQuery` 可行性高——无 Vue 依赖、无副作用，现有测试基础设施（`vitest`）可直接覆盖
- ✅ `setProperty` / `ensureTodo` / `advanceDateRefInBlock` 均已在 `property.ts` 中实现，复用无障碍
- ✅ 路由系统（vue-router）和侧栏组件结构支持新增独立页面入口
- ✅ `SQLiteAdapter` 有完整的 `CREATE TABLE` 模式，新增两表只是照搬模式
- ⚠️ **`get_blocks_projection()` 的 SQL 实现复杂度被低估**——需要 `blocks` LEFT JOIN `properties`（1:N）LEFT JOIN `date_refs`（1:N），在 Rust 端组装成 `HashMap<String, Value>` + `Vec<DateRefLite>`。spec 只写了"一次 SQL 组装"，没写具体策略（单次大 SQL + Rust 端分组 vs 多次查询 + 内存组装）
- ⚠️ **WASM `SqlJsAdapter` 缺访问器问题不只是"新增表"**——spec §6.4 说"新增两表必须同时加到 SqlJsAdapter"，但实际 `sqljs.rs` 当前缺的是 `notifications` 访问器（pre-existing 阻塞），新增 `saved_filters`/`task_views` 需要同样补齐 CRUD 访问器。spec 把这个工作量轻描淡写了
- ⚠️ **缓存失效依赖订阅 `blockStore`/`propertyStore` 的写操作**——但当前 store 并无统一的事件/订阅机制。`blocks.ts` 的 `updateBlockContent` 等方法是直接操作，没有 emit 事件。实现时需要引入 watch 或手动标记脏，spec 没描述具体方案
- ❌ **`content_preview` 的生成方式未定义**——spec 说"去掉 `{{schedule:…}}`/`{{deadline:…}}` 标记后的摘要"，但没说在 Rust 端还是前端做、截断长度多少、是否去 Markdown 语法。这直接影响 `contains` 筛选的语义

**发现的问题：**

3. `get_blocks_projection()` 的 SQL 组装策略未明确（单 SQL JOIN vs 多查询组装）
4. WASM `SqlJsAdapter` 新增表的访问器工作量被低估
5. 缓存失效机制缺少具体方案（当前 store 无事件/订阅机制）
6. `content_preview` 生成方式未定义（后端 vs 前端、截断策略、Markdown 处理）

---

### 3. 完整性 ❌

**检查结果：**

- ✅ 核心功能覆盖：数据投影、筛选引擎、三视图、命名视图持久化、入口导航
- ✅ 非目标明确（§1.3）：页面内视图、OR 条件、Gallery/Timeline 等排除在外
- ✅ 错误处理定义了三个场景（加载失败、配置损坏、源 block 不存在）
- ✅ 与现有系统关系明确（§11）：property-spec §9.2 落地、date_ref 复用、任务生命周期复用
- ✅ 实施阶段建议（§12）P1–P6 分层合理，P1–P3 可并行
- ❌ **缺少 `task_views` 与 `saved_filters` 的关系定义**——spec §6 说 `task_views` = 保存的筛选规则 + viewType，但没说 `task_views.query_json` 是**内联** `BlockQuery` 还是**引用** `saved_filters.id`。如果是内联，用户改了 `saved_filters` 不会影响已存的任务视图；如果是引用，删除 `saved_filters` 后任务视图怎么办？
- ❌ **缺少「全部任务」默认视图的初始化逻辑**——§6.2 说默认视图 `status hasAny`，但没说谁创建它、什么时候创建、是否可删除
- ❌ **缺少 `TaskHub` 的路由定义**——§5.1 说"全局路由/浮层"，§7 说"左侧栏常驻项 + 命令面板"，但 `routes.ts` 里没写对应的路由记录（path/name/component）
- ❌ **缺少排序的默认行为**——`SortRule` 类型定义了，但没说默认排序（如无 sort 规则时按 `updated_at desc`？按 `pos`？）
- ⚠️ **缺少 `GroupBy` 在表格视图中的语义**——表格视图按列展示，`groupBy` 对表格意味着什么？分组折叠？分节显示？spec 只说"分组由视图层按需计算"
- ⚠️ **看板拖拽到 Done 触发 `advanceDateRefInBlock` 的条件未明确**——如果 block 没有 recurrence 的 dateRef，拖到 Done 是否也只是 `setProperty(status=Done)`？需明确"仅当存在 recurrence 时才推进"

**发现的问题：**

7. `task_views` 与 `saved_filters` 的引用关系未定义（内联 vs 外键）
8. 默认视图「全部任务」的初始化逻辑缺失
9. `TaskHub` 路由记录未定义
10. 默认排序行为未定义
11. `groupBy` 在表格视图中的语义未定义
12. 看板拖到 Done 触发周期推进的条件未明确

---

### 4. 用户体验 ⚠️

**检查结果：**

- ✅ 三视图覆盖任务管理的三个核心视角（列表/流转/时间）
- ✅ 行内编辑（表格勾选、看板拖拽）减少上下文切换
- ✅ 跳回源 block 保留上下文
- ✅ 命名视图支持「逾期任务」「我的一周」等场景化快速切换
- ⚠️ **筛选规则构建器的学习成本**——通用字段 + 操作符 + 值的构建器对技术用户友好，但对非技术用户可能偏复杂。Notion 的筛选 UI 有较好的视觉引导（chip 式条件展示），spec 未描述 UI 交互细节
- ⚠️ **看板拖拽改 status 的反馈**——拖拽后如果触发周期推进（dateRef 变更），用户需要看到日期变化的反馈。spec 未定义这个反馈机制
- ⚠️ **大数据量下的性能体感**——全量加载所有 block 投影，如果 vault 有几千个 block，首次加载可能有感知延迟。spec 说了"万级无压力"但没给数据支撑
- ⚠️ **从任务中心编辑后，源页面已打开时的同步**——如果用户同时打开了源页面和任务中心，在任务中心改了 status，源页面的 block 显示需要同步更新。spec 的缓存失效机制不明确（呼应问题 5）

**发现的问题：**

13. 筛选规则构建器 UI 交互细节未描述（学习成本/视觉引导）
14. 看板拖拽触发周期推进时缺少日期变化的反馈机制
15. 任务中心与源页面同时打开时的双向同步未定义

---

## 问题清单

| 严重程度 | 维度 | 问题描述 | 建议 |
|---------|------|---------|------|
| 🔴 高 | 完整性 | `task_views` 与 `saved_filters` 的引用关系未定义 | 明确为内联 `BlockQuery`（非外键引用），避免级联删除问题；`saved_filters` 作为「模板库」独立存在 |
| 🔴 高 | 可行性 | 缓存失效机制缺少具体方案 | 明确方案：在 `blockCard` store 中 watch `blockStore`/`propertyStore` 的关键 state，或引入显式 `invalidateCard(blockId)` 调用点 |
| 🔴 高 | 可行性 | `content_preview` 生成方式未定义 | 明确：Rust 端用正则去 `{{...}}` 标记 + 截断 200 字符；不做 Markdown 解析（保留原始文本） |
| 🟡 中 | 一致性 | 引擎文件名 `useTaskQuery.ts` 与通用定位矛盾 | 改为 `useBlockQuery.ts` 或 `blockQueryEngine.ts` |
| 🟡 中 | 完整性 | `TaskHub` 路由记录未定义 | 补充 `routes.ts` 中的 `{ path: '/tasks', name: 'tasks', component: () => import('...TaskHub.vue'), meta: { fullWidth: true } }` |
| 🟡 中 | 完整性 | 默认视图初始化逻辑缺失 | 补充：首次打开任务中心时检查 `task_views` 表为空则插入默认视图「全部任务」（`is_default=1`，不可删除） |
| 🟡 中 | 完整性 | 默认排序行为未定义 | 补充：无 sort 规则时默认按 `updated_at desc` |
| 🟡 中 | 可行性 | `get_blocks_projection()` SQL 组装策略未明确 | 建议多次查询 + Rust 端内存组装（避免复杂 JOIN 的性能陷阱和 N+1 问题） |
| 🟡 中 | 用户体验 | 任务中心与源页面同时打开时的双向同步未定义 | 明确：`blockCard` store 失效后重跑 `applyQuery`；源页面通过现有 `propertyStore` 响应式更新 |
| 🟢 低 | 完整性 | `groupBy` 在表格视图中的语义未定义 | 明确：表格视图忽略 `groupBy`（仅看板/日历使用） |
| 🟢 低 | 完整性 | 看板拖到 Done 触发周期推进的条件未明确 | 明确：仅当 block 有 `recurrence != 'none'` 的 dateRef 时才推进，否则仅 `setProperty(status=Done)` |
| 🟢 低 | 一致性 | `BlockCard` vs `Block` 术语混用 | 在 spec 中增加术语说明段 |
| 🟢 低 | 用户体验 | 筛选构建器 UI 交互细节未描述 | 实施阶段补充线框图 |
| 🟢 低 | 用户体验 | 看板拖拽触发周期推进时缺少反馈机制 | 实施阶段补充 toast 提示「已推进至下一周期」 |
| 🟢 低 | 可行性 | WASM SqlJsAdapter 访问器工作量 | 在实施计划中单独列出 SqlJsAdapter 补齐任务 |

---

## 改进建议

### 高优先级（必须在 spec 中修复）

1. **明确 `task_views` 与 `saved_filters` 的关系**：`task_views.query_json` 内联完整 `BlockQuery`（非外键引用 `saved_filters.id`）。`saved_filters` 作为可复用的筛选规则模板库，用户可从模板创建任务视图（复制规则），但之后两者独立。避免级联删除问题。

2. **明确缓存失效方案**：在 `blockCard` store 中用 `watch(() => blockStore.blocksVersion, ...)` + `watch(() => propertyStore.propertiesVersion, ...)` 监听变化并标记脏；或在 `updateBlockContent`/`setProperty`/date-ref 变更的调用点显式调用 `blockCardStore.invalidate(blockId)`。

3. **明确 `content_preview` 生成方式**：Rust 端在组装 `BlockCard` 时，对 `block.content` 做正则替换去掉 `{{schedule:…}}`/`{{deadline:…}}` 标记，截断 200 字符。不做 Markdown 解析，保留原始文本。

### 中优先级（建议在 spec 中补充）

4. **统一命名**：`useTaskQuery.ts` → `useBlockQuery.ts`；声明 `BlockCard` 术语选择。

5. **补充路由定义**：`{ path: '/tasks', name: 'tasks', component: () => import('...TaskHub.vue'), meta: { fullWidth: true, hideRightSidebarToggle: true } }`

6. **补充默认视图初始化**：首次进入任务中心，`task_views` 表为空时插入「全部任务」默认视图（`is_default=1`，不可删除，可修改其筛选规则）。

7. **补充默认排序**：无 `sort` 规则时按 `updated_at desc`。

8. **明确 SQL 策略**：分三次查询（blocks → properties → date_refs），Rust 端用 `HashMap` 按 `block_id` 组装。避免单次三表 JOIN 的性能与复杂度。

### 低优先级（实施阶段处理）

9. **补充 `groupBy` 语义**：表格视图忽略 `groupBy`。
10. **明确周期推进条件**：仅 `recurrence != 'none'` 时推进。
11. **补充术语说明段**。
12. **实施阶段补 UI 线框图与 toast 反馈**。

---

## 审核结论

**结论：需修改后通过**

设计方案整体思路清晰，分层合理，泛化定位准确，已验证的关键假设与代码对齐。存在 3 个高优问题（task_views/saved_filters 关系、缓存失效方案、content_preview 定义）和 5 个中优问题，需在 spec 中修复后方可进入实施计划阶段。低优问题可在实施阶段处理。

建议修复全部 🔴 高 + 🟡 中问题后，重新确认 spec，再调用 writing-plans 拆实施计划。
