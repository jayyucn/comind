import type { BuiltinTemplate } from '../types/template'

/**
 * 内置模板清单（10 个）
 *
 * 修改原则：
 * 1. 任何修改需保持 ID 全局唯一
 * 2. blocks 数组至少 1 个元素
 * 3. heading 类型必须指定 headingLevel
 * 4. property 类型必须指定 propertyKey
 */
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ─── 思维模型类（5 个） ───────────────────────────────────
  {
    id: 'second-order-thinking',
    name: '二阶思维',
    aliases: ['second-order', '2nd-order'],
    category: 'thinking-model',
    description: '引导追问"然后呢？"',
    icon: '🤔',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '二阶思维: {{cursor}}' },
      { type: 'bullet', content: '## 一阶：直接结果是什么？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '二阶：然后呢？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '三阶：再然后呢？' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'five-whys',
    name: '5WHY 分析',
    aliases: ['5why', 'five-whys'],
    category: 'thinking-model',
    description: '连问 5 个为什么找根因',
    icon: '❓',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '5WHY 分析: {{cursor}}' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'bullet', content: '## 问题：' },
      { type: 'bullet', content: '## Why 1：' },
      { type: 'bullet', content: '## Why 2：' },
      { type: 'bullet', content: '## Why 3：' },
      { type: 'bullet', content: '## Why 4：' },
      { type: 'bullet', content: '## Why 5（根因）：' },
    ]
  },
  {
    id: 'mece',
    name: 'MECE 拆解',
    aliases: ['mece', '互斥穷尽'],
    category: 'thinking-model',
    description: '相互独立、完全穷尽地拆解问题',
    icon: '🧩',
    blocks: [
      { type: 'heading', headingLevel: 2, content: 'MECE 拆解: {{cursor}}' },
      { type: 'bullet', content: '## 待拆解问题：' },
      { type: 'heading', headingLevel: 3, content: '维度 1' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '维度 2' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '维度 3' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'first-principles',
    name: '第一性原理',
    aliases: ['first-principles', '第一性'],
    category: 'thinking-model',
    description: '剥离假设，回到基本事实',
    icon: '⚛️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '第一性原理: {{cursor}}' },
      { type: 'bullet', content: '## 当前方案/共识：' },
      { type: 'heading', headingLevel: 3, content: '基本事实（不可再分）：' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '基于基本事实的重新推导：' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'premortem',
    name: '预先验尸',
    aliases: ['premortem', '预失败'],
    category: 'thinking-model',
    description: '假设项目已失败，反推原因',
    icon: '⚰️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '预先验尸: {{cursor}}' },
      { type: 'bullet', content: '## 假设 {{date}} 项目彻底失败，原因是：' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '可提前规避的行动：' },
      { type: 'bullet', content: '' },
    ]
  },

  // ─── 工作类（5 个） ───────────────────────────────────
  {
    id: 'meeting-notes',
    name: '会议记录',
    aliases: ['meeting', '会议'],
    category: 'work',
    description: '结构化记录会议：时间/参与人/议题/决议/待办',
    icon: '📝',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '会议: {{cursor}}' },
      { type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' },
      { type: 'property', propertyKey: '参与人', content: '' },
      { type: 'heading', headingLevel: 3, content: '议题' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '决议' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '待办' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'weekly-review',
    name: '每周复盘',
    aliases: ['weekly-review', 'weekly', '周报', '复盘'],
    category: 'review',
    description: '5 个引导问题：精力/注意力/思考/决策/目标',
    icon: '📋',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '周复盘 ({{iso_date}})' },
      { type: 'heading', headingLevel: 3, content: '1. 这周精力最好的时候是？什么时候最差？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '2. 这周什么消耗了最多注意力？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '3. 这周最深的思考是什么？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '4. 这周有哪些决策需要复盘？' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '5. 下周最重要的 3 件事？' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'daily-ideas',
    name: '今日记录',
    aliases: ['daily', 'ideas', '点滴', '今日'],
    category: 'ideas',
    description: '心情/进展/卡点/明日计划',
    icon: '🌅',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '{{iso_date}}' },
      { type: 'property', propertyKey: '心情', content: '' },
      { type: 'heading', headingLevel: 3, content: '今日进展' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '卡点' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '明日计划' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'decision-record',
    name: '决策记录',
    aliases: ['decision', '决策'],
    category: 'work',
    description: '背景/选项/权衡/决定/复盘',
    icon: '⚖️',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '决策: {{cursor}}' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'heading', headingLevel: 3, content: '背景' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '候选方案' },
      { type: 'bullet', content: '方案 A：' },
      { type: 'bullet', content: '方案 B：' },
      { type: 'bullet', content: '方案 C：' },
      { type: 'heading', headingLevel: 3, content: '权衡' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '决定' },
      { type: 'bullet', content: '' },
    ]
  },
  {
    id: 'reading-notes',
    name: '阅读笔记',
    aliases: ['reading', 'book', '阅读'],
    category: 'work',
    description: '元信息/核心观点/我的启发/行动项',
    icon: '📖',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '阅读笔记: {{cursor}}' },
      { type: 'property', propertyKey: '作者', content: '' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
      { type: 'heading', headingLevel: 3, content: '核心观点' },
      { type: 'bullet', content: '' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '我的启发' },
      { type: 'bullet', content: '' },
      { type: 'heading', headingLevel: 3, content: '行动项' },
      { type: 'bullet', content: '' },
    ]
  },
]

/**
 * 按 ID 查询内置模板
 */
export function getBuiltinTemplate(id: string): BuiltinTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id)
}
