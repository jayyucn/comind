# 可配置属性显示系统设计文档

## 概述
提供可配置的属性显示系统，支持按单个属性配置显示位置和显示样式。

## 需求
1. **显示位置**：
   - `between-bullet-content`：在 bullet 和内容之间
   - `right-of-content`：在内容区右侧
   - `bottom-of-block`：在 block 下方（默认）
2. **显示样式**：
   - `icon-text`：图标+文字
   - `icon`：仅图标
   - `text`：仅文字
3. **配置粒度**：按单个属性配置
4. **内建属性**：配置硬编码在 BUILT_IN_PROPERTIES 中
5. **用户属性**：配置保存到数据库

## 数据结构

### PropertyDefinition 扩展
```typescript
export interface PropertyDefinition {
  key: string
  title: string
  type: PropertyType
  closedValues?: ClosedValue[]
  isBuiltIn?: boolean
  description?: string
  
  // 新增配置字段
  displayPosition?: 'between-bullet-content' | 'right-of-content' | 'bottom-of-block'
  displayStyle?: 'icon-text' | 'icon' | 'text'
}
```

## 内建属性默认配置

| 属性 | 默认显示位置 | 默认显示样式 |
|------|------------|------------|
| `status` | `between-bullet-content` | `icon` |
| `priority` | `between-bullet-content` | `icon` |
| `deadline` | `bottom-of-block` | `icon-text` |
| `scheduled` | `bottom-of-block` | `icon-text` |
| `tags` | `bottom-of-block` | `icon-text` |
| `project` | `bottom-of-block` | `icon-text` |
| `area` | `bottom-of-block` | `icon-text` |

## Block 布局结构

```
┌──────────────────────────────────────────────────────────────────┐
│ [indent] [bullet] [属性（between）] [内容] [属性（right）]         │
│ └────────────────────────────────────────────────────────────────┘
│
│ [属性（bottom）]                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 组件职责划分

| 组件 | 负责位置 |
|------|--------|
| **PropertyInline.vue**（新建） | `between-bullet-content`、`right-of-content` |
| **PropertyDisplay.vue** | `bottom-of-block` |

## 数据持久化

### 内建属性
配置硬编码在 `src/types/property.ts` 的 `BUILT_IN_PROPERTIES` 数组中。

### 用户自定义属性
需设计存储表结构（待后续补充），包含：
- 属性基础信息（key、标题、类型、封闭值）
- 显示配置（显示位置、显示样式）

## 实施路线
1. 更新 PropertyDefinition 类型
2. 给 BUILT_IN_PROPERTIES 添加默认配置
3. 创建 PropertyInline.vue 组件
4. 更新 Block.vue 集成新的布局
5. 更新 PropertyDisplay.vue
6. 设计用户自定义属性存储（后续）
