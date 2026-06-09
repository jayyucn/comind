# Concept Block 设计文档

> 日期：2026-06-06
> 状态：Approved

## 概述

Concept Block 是一种标准化的概念深潜呈现形式，帮助用户"吃透"一个概念。通过固定的四区结构（核心定义、边界范围、对标辨析、实例应用），确保每个概念都得到完整的深度处理。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 视觉形式 | 折叠式四区卡片 | 信息密度高，一眼纵览，适合复习查阅 |
| 编辑方式 | 内联编辑（子 Block） | 与现有编辑体验一致，零学习成本 |
| 结构 | 固定四区 | 保证概念深潜的完整性，避免遗漏 |
| 触发方式 | `/concept` 斜杠命令 | 与现有 slash command 体系一致 |

## 四区结构

### 01 · 核心定义
- **色彩编码**：琥珀色标签 + 靛蓝左边框
- **内容**：一句话抓本质，精简原文释义，剔除冗余，用自己的话复述内涵
- **渲染**：带左边框的引用块样式
- **默认状态**：展开

### 02 · 边界范围
- **色彩编码**：绿色（外延）/ 红色（禁区）
- **内容**：
  - 外延：包含哪些事物、适用场景
  - 禁区：哪些情况不属于该概念（反例）
- **渲染**：绿红并排双栏
- **默认状态**：展开

### 03 · 对标辨析
- **色彩编码**：靛蓝
- **内容**：和相近、易混淆概念做对比，列明关键差异点
- **渲染**：VS 对比卡（左右并排）
- **默认状态**：展开

### 04 · 实例与应用
- **色彩编码**：紫色
- **内容**：
  - 正向实例 2～3 个
  - 落地用法：现实中什么时候用、用来解决什么问题
- **渲染**：实例卡片 + 用法卡片
- **默认状态**：展开

## 数据模型

复用现有 Block 树结构，不引入新数据表。

```
Concept Block (type: 'concept')
├── 子Block: 核心定义 (type: 'concept-definition')
├── 子Block: 边界范围 (type: 'concept-boundary')
├── 子Block: 对标辨析 (type: 'concept-comparison')
└── 子Block: 实例应用 (type: 'concept-example')
```

- Concept Block 的 `content` 字段存储概念名称（如"函数式编程"）
- 四个子 Block 通过 `parentId` 关联到 Concept Block
- 每个子 Block 的 `content` 为富文本，用户自由编辑
- 边界范围子 Block 的内容格式约定：用 `---` 分隔外延和禁区

## 渲染逻辑

### 非激活态（展示模式）
- 渲染为折叠式四区卡片
- 概念名称作为卡片标题
- 每个区域可独立折叠/展开
- 点击任意区域内容 → 激活该子 Block 进入编辑

### 激活态（编辑模式）
- Concept Block 标题变为可编辑
- 四个子 Block 切换为普通 Block 编辑模式
- 与现有 Block 编辑体验完全一致

## 视觉规格

### 卡片容器
- 背景：`var(--bg-base)`
- 边框：`1px solid var(--border)`
- 圆角：`var(--radius-md)` (10px)
- 阴影：`var(--shadow-elevation-1)`

### 标题栏
- 左侧：概念图标（靛蓝渐变圆角方块 + 原子符号）
- 中间：概念名称（18px, font-weight 700）
- 右侧：「概念」标签（accent-subtle 背景）

### 区域分隔
- 区域间用 `1px solid var(--border)` 分隔
- 每个区域有色彩编码的序号标签

## 与概念图谱的关系

- Concept Block 的标题自动成为概念图谱中的节点
- 概念块之间的 WikiLink 关系在图谱中显示为边
- 在图谱中点击节点可导航到对应的 Concept Block

## 创建流程

1. 用户输入 `/concept`
2. SlashCommandMenu 显示「概念」选项
3. 选中后：
   - 创建 `type: 'concept'` 的 Block，content 为空
   - 自动创建 4 个子 Block（definition/boundary/comparison/example）
   - 子 Block 可选预填引导文字（如"一句话抓本质..."）
4. 激活概念名称进入编辑

## 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/components/Block/handlers/concept/ConceptRender.vue` | 新增 | 概念块展示渲染 |
| `src/components/Block/handlers/concept/ConceptEditor.vue` | 新增 | 概念块编辑（标题编辑） |
| `src/components/Block/handlers/concept/index.ts` | 新增 | handler 注册 |
| `src/components/Block/handlers/concept/ConceptSection.vue` | 新增 | 单个区域的折叠/展开组件 |
| `src/composables/useBlockRegistry.ts` | 修改 | 注册 concept 及子类型 handler |
| `src/composables/useSlashCommands.ts` | 修改 | 添加 `/concept` 命令 |
| `src/config/builtin-templates.ts` | 修改 | 添加 concept 模板 |
| `src/styles/components/_block.scss` | 修改 | 添加概念块样式 |

## 不做的事

- 不做自定义区域（固定四区）
- 不做概念块的嵌套（概念块内不能再建概念块）
- 不做 AI 自动填充（后续迭代考虑）
- 不做概念块之间的自动关联（依赖手动 WikiLink）
