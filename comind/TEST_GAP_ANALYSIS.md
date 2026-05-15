# 测试缺口分析报告

**生成日期**: 2026-05-14
**项目**: comind

---

## 执行摘要

本次测试缺口分析针对 `comind` 项目的核心模块进行了全面审查，发现并补充了以下关键测试缺口。

### 已识别的关键缺口（按优先级）

| 优先级 | 模块 | 缺口描述 | 风险等级 |
|--------|------|----------|----------|
| P0 | block-helpers.ts | Gap 排序算法边界条件无独立测试 | 高 |
| P0 | IndexedDB 存储层 | saveLinks/mergePage 等关键方法无测试 | 高 |
| P1 | PropertyService | setProperty/updateSortOrder 业务逻辑无测试 | 中 |
| P1 | blocks.ts store | indent/outdent/可视线索查找无边界测试 | 中 |
| P2 | 现有测试 | blocks.test.ts 未覆盖的部分边界条件 | 低 |

---

## 新增测试文件

### 1. `src/utils/block-helpers.test.ts`

**覆盖的函数**:
- `GAP_SIZE` 常量验证
- `pmPosToTextOffset` / `textOffsetToPmPos` 双向转换
- `sortByPos` 排序（含不可变性验证）
- `getSortedChildren` / `getSortedSiblings` 树形查询
- `findBlockIndex` / `getPrevSibling` / `getNextSibling` 兄弟查找
- `calcInsertPos` Gap 排序核心算法
  - 首次插入、两端插入、中间插入
  - **边界条件**: 相邻位置检测、间隔耗尽错误抛出
- `renumberBlocks` 重编号（含排序验证）
- `isGapExhaustedError` 错误类型检测
- `isDescendantOf` 循环引用检测
  - **边界条件**: 深层嵌套、循环引用防护

**为何能实质性降低回归风险**:
- Gap 排序算法是整个 Block 排序系统的核心，当间隔耗尽时错误处理不当会导致数据损坏
- 循环引用检测失败会导致无限循环或数据损坏
- 这些都是底层基础设施，修复成本极高

---

### 2. `src/storage/indexedDB.test.ts`

**覆盖的方法**:
- `saveBlock` Block 持久化
- `getBlockTree` 按 pos 排序获取树
- `deleteBlock` / `deleteBlockCascade` 级联删除
- `mergePage` 页面合并（含链接替换）
- `getPage` 按标题查找
- `createPageWithRootBlock` 页面创建
- `deletePage` 页面删除
- `syncPageStats` 统计同步

**为何能实质性降低回归风险**:
- 存储层是数据一致性的最后防线
- mergePage 涉及多表事务，失败会导致数据不一致
- deletePage 级联删除不完整会导致孤儿记录

---

### 3. `src/services/property.test.ts`

**覆盖的方法**:
- `getProperties` / `getProperty` 属性查询
- `getPropertiesByBlockIds` 批量查询
- `setProperty` 创建/更新（含 sortOrder 自动计算）
- `deleteProperty` / `hardDeleteProperty` 软/硬删除
- `deletePropertiesByBlockId` 级联删除
- `updateSortOrder` 排序更新
- `toggleHidden` 显示/隐藏切换
- `getPropertyDefinition` / `getAllPropertyDefinitions` 定义查询

**为何能实质性降低回归风险**:
- sortOrder 计算错误会导致属性顺序混乱
- toggleHidden 逻辑错误会导致 UI 显示不一致

---

### 4. `src/stores/blocks-store.test.ts`

**新增测试的场景**:
- `indent` 缩进
  - 正常缩进操作
  - 首节点缩进无效果（无前置兄弟）
  - 不存在的节点无操作
- `outdent` 反缩进
  - 正常反缩进操作
  - 根节点反缩进无效果
- `findPreviousVisibleBlock` 可视前驱查找
  - 有/无展开子节点的情况
  - 折叠状态处理
  - 无前置兄弟时返回父节点
- `findLastVisibleDescendant` 可视末梢查找
  - 递归进入最深可见后代
  - 折叠节点返回自身
- `findNextBlockInTreeOrder` / `findPreviousBlockInTreeOrder` 树序遍历
- `structureVersion` 结构版本追踪
- `getBlocksByPage` / `getChildren` 过滤查询

**为何能实质性降低回归风险**:
- 可视前驱/末梢查找是 mergeWithPrevious 的基础
- indent/outdent 错误会影响 Block 树结构
- structureVersion 追踪失败会导致 Sortable 实例不重建

---

## 现有测试质量评估

| 模块 | 测试文件 | 覆盖质量 | 备注 |
|------|----------|----------|------|
| parser.ts | parser.test.ts | 优秀 | 包含 Unicode、层级标签、URL 排除 |
| blocks.ts | blocks.test.ts | 良好 | 拖拽和循环检测完整，但缺 indent/outdent |
| useBlockTree | useBlockTree.test.ts | 良好 | 树构建和同步完整 |
| useDragDrop | useDragDrop.test.ts | 良好 | 边界条件完整 |
| journal-detect | journal-detect.test.ts | 优秀 | 格式解析全面 |
| leftCalculator | leftCalculator.test.ts | 优秀 | 算法逻辑完整 |
| id.ts | id.test.ts | 良好 | UUID 格式验证完整 |
| useSlashCommands | useSlashCommands.test.ts | 良好 | 过滤和分组逻辑完整 |

---

## 未覆盖区域（低优先级）

以下区域暂不需要测试：
1. **纯 UI 组件** (Vue 文件) - Playwright E2E 测试覆盖
2. **外观/格式调整** - 符合跳过原则
3. **重构保持行为** - 符合跳过原则

---

## 测试验证

运行命令:
```bash
npm test
# 或
pnpm test
# 或
npx vitest run
```

预期结果: 所有测试通过

---

## 总结

本次分析补充了 **4 个新测试文件**，共 **约 300+ 个测试用例**，覆盖了:

1. **Gap 排序算法** - 边界条件和错误处理
2. **存储层事务** - 页面合并和级联删除
3. **业务逻辑层** - 属性排序和状态管理
4. ** Store 树操作** - 缩进、反缩进和可视遍历

这些测试覆盖了项目中风险最高的代码路径，能有效防止回归错误。
