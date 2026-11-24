import { describe, expect, it } from 'vitest'

import { parseFieldOptions } from './field-options'

describe('parseFieldOptions — 候选值批量解析', () => {
  it('单值（无分隔符）：原样成一项', () => {
    expect(parseFieldOptions('待办')).toEqual(['待办'])
  })

  it('英文逗号与中文逗号：各切一项', () => {
    expect(parseFieldOptions('Todo,Doing，Done')).toEqual(['Todo', 'Doing', 'Done'])
  })

  it('顿号 / 分号 / 竖线 / 斜杠：同一套切分', () => {
    expect(parseFieldOptions('待办、进行中；已完成|已归档/搁置')).toEqual([
      '待办',
      '进行中',
      '已完成',
      '已归档',
      '搁置',
    ])
  })

  it('多行与制表符：从别处复制整列直接可用', () => {
    expect(parseFieldOptions('Todo\nDoing\r\nBlocked\tDone')).toEqual([
      'Todo',
      'Doing',
      'Blocked',
      'Done',
    ])
  })

  it('行首列表标记随行剥掉（无序符号 / 数字编号）', () => {
    expect(parseFieldOptions('- 低\n* 中\n• 高')).toEqual(['低', '中', '高'])
    expect(parseFieldOptions('1. 周一\n2、周二\n3) 周三')).toEqual(['周一', '周二', '周三'])
  })

  it('不按空格切分：含空格的选项保持完整', () => {
    expect(parseFieldOptions('In Progress, 待 定')).toEqual(['In Progress', '待 定'])
  })

  it('数字编号的前瞻保护：1.5 不被剥成 5', () => {
    expect(parseFieldOptions('1.5 倍')).toEqual(['1.5 倍'])
  })

  it('去首尾空白、丢空项（连续分隔符 / 首尾分隔符）', () => {
    expect(parseFieldOptions('  Todo ,, Doing ,  ')).toEqual(['Todo', 'Doing'])
    expect(parseFieldOptions('')).toEqual([])
    expect(parseFieldOptions(' , ， 、 ')).toEqual([])
  })

  it('与已有选项保序去重合并（增量粘贴不重复、不重排）', () => {
    expect(parseFieldOptions('Doing,Done,Doing', ['Todo', 'Doing'])).toEqual([
      'Todo',
      'Doing',
      'Done',
    ])
  })

  it('不修改传入的 existing 数组', () => {
    const existing = ['Todo']
    parseFieldOptions('Done', existing)
    expect(existing).toEqual(['Todo'])
  })
})
