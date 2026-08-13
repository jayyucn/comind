import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  decodeRelationshipContent,
  encodeRelationshipContent,
  parseRelationshipSegment,
} from './relationship-content'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { cleanupRelationshipTypes } from '../../tests/core-client'

describe('parseRelationshipSegment', () => {
  it('单方向', () => {
    expect(parseRelationshipSegment('is-a')).toEqual({
      raw: 'is-a',
      type: 'is-a',
    })
  })

  it('双向 <->', () => {
    expect(parseRelationshipSegment('depends-on<->required-by')).toEqual({
      raw: 'depends-on<->required-by',
      type: 'depends-on',
      inverse: 'required-by',
    })
  })

  it('auto-inverse !', () => {
    expect(parseRelationshipSegment('depends-on!')).toEqual({
      raw: 'depends-on!',
      type: 'depends-on',
      autoInverse: true,
    })
  })

  it('带空格 trim', () => {
    expect(parseRelationshipSegment(' is-a ')).toEqual({
      raw: ' is-a ',
      type: 'is-a',
    })
  })
})

describe('relationship-content decode/encode（round-trip）', () => {
  beforeEach(async () => {
    await cleanupRelationshipTypes()
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
    const { load } = useRelationshipTypes()
    await load()
  })

  afterEach(async () => {
    await cleanupRelationshipTypes()
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
  })

  it('decode：单方向 type → label', () => {
    const { text, snapshot } = decodeRelationshipContent('前置 ((is-a))[[项目A]] 后置')
    expect(text).toBe('前置 ((是一个))[[项目A]] 后置')
    expect(snapshot.get('是一个')).toBe('is-a')
  })

  it('decode：双向 <-> → label<->inverseLabel', () => {
    const { text, snapshot } = decodeRelationshipContent('((depends-on<->required-by))[[A]]')
    expect(text).toBe('((依赖<->被依赖))[[A]]')
    expect(snapshot.get('依赖<->被依赖')).toBe('depends-on<->required-by')
  })

  it('decode：auto-inverse ! → label!', () => {
    const { text, snapshot } = decodeRelationshipContent('((depends-on!))[[A]]')
    expect(text).toBe('((依赖!))[[A]]')
    expect(snapshot.get('依赖!')).toBe('depends-on!')
  })

  it('decode：inverse type → inverseLabel', () => {
    const { text } = decodeRelationshipContent('((has-instance))[[A]]')
    expect(text).toBe('((有实例))[[A]]')
  })

  it('decode：未知 type 原样保留、不记快照', () => {
    const { text, snapshot } = decodeRelationshipContent('((unknown-type))[[A]]')
    expect(text).toBe('((unknown-type))[[A]]')
    expect(snapshot.size).toBe(0)
  })

  it('decode：双向中反向未知 → 整体原样保留', () => {
    const { text, snapshot } = decodeRelationshipContent('((is-a<->unknown))[[A]]')
    expect(text).toBe('((is-a<->unknown))[[A]]')
    expect(snapshot.size).toBe(0)
  })

  it('decode：不含 (( 的文本原样返回', () => {
    const { text, snapshot } = decodeRelationshipContent('普通文本 [[A]]')
    expect(text).toBe('普通文本 [[A]]')
    expect(snapshot.size).toBe(0)
  })

  it('encode：label → type（单方向）', () => {
    expect(encodeRelationshipContent('前置 ((是一个))[[项目A]] 后置')).toBe(
      '前置 ((is-a))[[项目A]] 后置',
    )
  })

  it('encode：双向 label<->inverseLabel → type<->inverse', () => {
    expect(encodeRelationshipContent('((依赖<->被依赖))[[A]]')).toBe(
      '((depends-on<->required-by))[[A]]',
    )
  })

  it('encode：auto-inverse label! → type!', () => {
    expect(encodeRelationshipContent('((依赖!))[[A]]')).toBe('((depends-on!))[[A]]')
  })

  it('encode：inverseLabel → inverse type', () => {
    expect(encodeRelationshipContent('((被依赖))[[A]]')).toBe('((required-by))[[A]]')
  })

  it('encode：未知 label 原样保留', () => {
    expect(encodeRelationshipContent('((不存在的关系))[[A]]')).toBe(
      '((不存在的关系))[[A]]',
    )
  })

  it('round-trip：decode 后 encode 还原为原 type', () => {
    const original = '((depends-on))[[A]] 和 ((has-instance))[[B]]'
    const { text, snapshot } = decodeRelationshipContent(original)
    expect(encodeRelationshipContent(text, snapshot)).toBe(original)
  })

  it('round-trip：双向 + auto-inverse 还原', () => {
    const original = '((is-a<->has-instance))[[A]] ((depends-on!))[[B]]'
    const { text, snapshot } = decodeRelationshipContent(original)
    expect(encodeRelationshipContent(text, snapshot)).toBe(original)
  })

  it('Q7：label 改名后未编辑的 block，encode 用快照还原为原 type', async () => {
    const original = '((is-a))[[A]]'
    const { text, snapshot } = decodeRelationshipContent(original)
    expect(text).toBe('((是一个))[[A]]')

    // 模拟设置里把 is-a 的 label 改成 "包含"（重新 load 后映射变化）
    await cleanupRelationshipTypes()
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
    // 重新 load 后 label 已变（这里模拟用户改 label：直接改 state）
    const { load, update, all } = useRelationshipTypes()
    await load()
    const isA = all.value.find(r => r.type === 'is-a')!
    await update(isA.id, { label: '包含', inverseLabel: '有实例' })
    expect(all.value.find(r => r.type === 'is-a')?.label).toBe('包含')

    // 编辑器里显示的是旧 label"是一个"（decode 时快照已记住 is-a）
    // 保存时 encode 应还原为 ((is-a))，而不是 ((是一个))
    expect(encodeRelationshipContent('((是一个))[[A]]', snapshot)).toBe(
      '((is-a))[[A]]',
    )
  })

  it('Q7：用户真正编辑了 label 文本 → 按新文本逆查', () => {
    const original = '((is-a))[[A]]'
    const { text, snapshot } = decodeRelationshipContent(original)
    expect(text).toBe('((是一个))[[A]]')
    // 用户把 label 改成 "属于"（另一个 type 的 label）
    expect(encodeRelationshipContent('((属于))[[A]]', snapshot)).toBe(
      '((part-of))[[A]]',
    )
  })

  it('已删除类型：decode 原样保留', async () => {
    const { softDelete, all } = useRelationshipTypes()
    const isA = all.value.find(r => r.type === 'is-a')!
    await softDelete(isA.id)
    const { text, snapshot } = decodeRelationshipContent('((is-a))[[A]]')
    expect(text).toBe('((is-a))[[A]]')
    expect(snapshot.size).toBe(0)
  })

  it('已删除类型：encode 原样保留', async () => {
    const { softDelete, all } = useRelationshipTypes()
    const isA = all.value.find(r => r.type === 'is-a')!
    await softDelete(isA.id)
    expect(encodeRelationshipContent('((是一个))[[A]]')).toBe('((是一个))[[A]]')
  })

  it('多条链接混合转换', () => {
    const { text, snapshot } = decodeRelationshipContent(
      '((is-a))[[A]] 和 ((uses))[[B]] 和普通文本',
    )
    expect(text).toBe('((是一个))[[A]] 和 ((使用))[[B]] 和普通文本')
    expect(encodeRelationshipContent(text, snapshot)).toBe(
      '((is-a))[[A]] 和 ((uses))[[B]] 和普通文本',
    )
  })
})
