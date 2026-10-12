/**
 * 块字段区行集合（list 变体的**唯一权威**）。
 *
 * 从 `BlockFieldZone.vue` 抽出（原内联 computed），抽出动机是「折叠守卫需要字段区实际
 * 渲染行数」——`tags.length` 只是代理值，标签有字段 ≠ 有可渲染行（between 内联槽字段、
 * hide_when 命中的字段都会让 `tags.length > 0` 而字段区一行不出）。守卫必须与渲染读同一份
 * 集合，否则出现「chevron 说能折叠、折下去什么都没藏」或反向的漂移。
 *
 * 消费方：
 * - `BlockFieldZone.vue`（variant="list"）——值渲染
 * - `Block/index.vue`——折叠守卫的字段行数（ADR-0045 折叠范围扩展）
 *
 * 集合定义：标签驱动字段（Rust `effective_field_ids` 解析单源）∪ 孤儿字段（块上已有值、
 * 但其 key 不在任何已挂标签有效字段并集中——删 tag / 去 tag 后悬空保留的值），
 * 两者各自过 `hide_when` 规则（判定逐块，单源在 `utils/field-hide`）。
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { useTagsStore } from '../../../stores/tags'
import type { FieldDefinition, RelationRefValue } from '../../../types/field-definition'
import { getFieldDefinition } from '../../../types/field-definition'
import type { FieldValue } from '../../../types/field-value'
import type { PersistedFieldDefinition } from '../../../types/tag-persisted'
import { decodeDefaultJson, isFieldHiddenByRule, normalizeHideWhen } from '../../../utils/field-hide'
import { decodeFieldValueData } from '../../../utils/field-value-codec'

/** 解码后的内存值（写回时的 `value_json` 由 codec 编码，此处还原）。 */
export function dataOf(fv: FieldValue): unknown {
  return decodeFieldValueData(fv.value_json, fv.value_type)
}

/** 编译期字段定义（displayPosition 等只存在于编译期，`PersistedFieldDefinition` 不持久化该字段）。 */
export function defOf(key: string): FieldDefinition | undefined {
  return getFieldDefinition(key)
}

export function useBlockFieldRows(
  blockId: MaybeRefOrGetter<string>,
  tagIds: MaybeRefOrGetter<string[]>,
) {
  const tagsStore = useTagsStore()
  const fieldValueStore = useFieldValueStore()

  /** 该块已挂标签（软删 / 悬空 id 由 store 静默过滤）。 */
  const tags = computed(() => tagsStore.resolveTags(toValue(tagIds)))

  /** 该块全部字段值行（含软删行，与迁移前同口径：默认无软删行）。 */
  const rows = computed<FieldValue[]>(() => fieldValueStore.getBlockFieldValues(toValue(blockId)))

  /** 持久化定义（用户覆盖列的唯一来源）；`all` 变体无 tagIds，只能按 key 反查。 */
  function persistedDefOf(key: string): PersistedFieldDefinition | undefined {
    return tagsStore.fieldDefinitions.find((d) => d.key === key)
  }

  /** 兜底合成最小定义（key 在库中无任何定义时的极端兜底；正常孤儿字段都有 persistedDefOf）。
   * 取字段值行的 value_type 作为合成类型——自定义远期类型（formula/json/color/geo/autonumber）
   * 无持久化定义时也能按真实类型渲染，而非被错当 string。 */
  function synthFieldDef(key: string, type: string = 'string'): PersistedFieldDefinition {
    return {
      id: key,
      key,
      title: key,
      type,
      closed_values: null,
      default_value: null,
      hide_when: 'never',
      is_system: false,
      created_at: 0,
      updated_at: 0,
      version: 1,
      deleted_at: null,
    }
  }

  /** 该块此字段的值形态：未填（无行 / 空串 / 空数组）→ null。 */
  function rawValueOf(def: PersistedFieldDefinition): string | null {
    const fv = fieldValueStore.getBlockFieldValue(toValue(blockId), def.key)
    if (!fv) return null
    const v = dataOf(fv)
    if (v === null || v === undefined || v === '') return null
    if (Array.isArray(v) && !v.length) return null
    // relation（issue T5）：值是 { targetId, relationshipTypeId } 对象——
    // 隐藏规则只关心「有没有值」，取 targetId 作为代表（String(obj) 会得到 "[object Object]"）
    if (def.type === 'relation') {
      const rel = v as Partial<RelationRefValue> | null
      return rel && typeof rel === 'object' && rel.targetId ? rel.targetId : null
    }
    return String(v)
  }

  /**
   * 隐藏规则判定（ADR-0050 D18，定义级共享）：规则单源在 `utils/field-hide`，
   * 这里只负责从 store 取值喂给它。注意这个判定是**逐块**的——
   * 「为空时隐藏」下同一字段在 A 块消失、在 B 块照常显示。
   */
  function isHiddenByRule(def: PersistedFieldDefinition): boolean {
    if (normalizeHideWhen(def.hide_when) === 'never') return false
    const value = rawValueOf(def)
    return isFieldHiddenByRule(
      def.hide_when,
      value !== null,
      value ?? '',
      decodeDefaultJson(def.default_value),
    )
  }

  /**
   * status ↔ priority 成对（UI 投影）：块无有效 status 值 → priority 各展示位隐藏
   * （行尾 right 图标 + 字段区 list 行）。删 status（backspace）即退出任务态，
   * priority 不再有意义；**值保留在库**（不删行），重设 status 后恢复（旧值回显）。
   * 判定口径与 rawValueOf 一致：无行 / 空串都算未设。
   */
  const hasStatusValue = computed(() => {
    const fv = fieldValueStore.getBlockFieldValue(toValue(blockId), 'status')
    if (!fv) return false
    const v = dataOf(fv)
    return v !== null && v !== undefined && v !== ''
  })

  /**
   * 标签有效字段并集（仅排除 between 内联槽；隐藏规则在下游 `fields` 与 `orphanFields`
   * 各自分别应用，故此处保留全量，使 `tagDrivenKeys` 能兜底——被隐藏规则拦掉的标签驱动
   * 字段不应被误判为孤儿值重新拉回展示）。
   *
   * 集合口径（原 BlockFieldZone 内联注释，随集合一起迁来）：
   * list 变体字段集合 = 标签驱动字段 ∪ 孤儿字段。本集合是块内**唯一的字段录入面**
   * （ADR-0050 D20：行内 chips 列已下线），故所有字段都列出——包括 `bottom-of-block`
   * 域字段与无 `displayPosition` 的自定义字段。
   *
   * 排除项只有 `between-bullet-content`（`status` 任务图标）：它由 bullet 与内容之间的
   * 内联槽渲染，属另一种视觉形态（图标而非「标题: 值」文本），在本集合再列一行是同物两渲染。
   *
   * `right-of-content`（`priority`）**不排除** —— ADR-0054 D4 明确：本集合是录入面
   * （唯一可写入口，点击唤起快速编辑器），行内 `right` 槽是只读展示位，两者职责不同、
   * 不互斥，不构成 ADR-0050 D19 意义上的「同物两渲染」。
   * 该判定经 `getFieldDefinition(key)` 反查编译期 `FieldDefinition.displayPosition`
   * （`PersistedFieldDefinition` 不持久化该字段，见 `tag-persisted.ts:6`）。
   */
  const tagDrivenDefs = computed<PersistedFieldDefinition[]>(() => {
    const seen = new Set<string>()
    const out: PersistedFieldDefinition[] = []
    for (const tag of tags.value) {
      for (const def of tagsStore.effectiveFieldDefinitions(tag.id)) {
        if (seen.has(def.id)) continue
        if (defOf(def.key)?.displayPosition === 'between-bullet-content') continue
        seen.add(def.id)
        out.push(def)
      }
    }
    return out
  })

  /** 标签驱动字段 key 全集（含被隐藏规则拦掉的）——用于剔除孤儿值，避免隐藏字段复活 */
  const tagDrivenKeys = computed<Set<string>>(() => new Set(tagDrivenDefs.value.map((d) => d.key)))

  /**
   * 孤儿字段（选项 A：删 tag / 去 tag 后让悬空值可见）。
   * 定义：该块已有 FieldValue 行，但其 key 不在当前 tag 有效字段并集中。
   * 删 tag 不删 FieldValue（`TagService::delete` 仅软删 tag 行），这些值原被 list 变体
   * 「tag 本位门控」整段隐身——A 改动把它们拉回录入面，弱区分样式以 Unlink 断链图标标注，
   * 仍可被查看与编辑（重新打同 tag 即回到正常态）。
   *
   * 排除项与 list 变体一致：deadline/scheduled 内联为 dateRef、between 内联槽、隐藏规则命中。
   */
  const orphanFields = computed<PersistedFieldDefinition[]>(() => {
    const seen = new Set<string>()
    const out: PersistedFieldDefinition[] = []
    for (const fv of rows.value) {
      if (tagDrivenKeys.value.has(fv.key)) continue
      if (seen.has(fv.key)) continue
      if (fv.key === 'deadline' || fv.key === 'scheduled') continue
      if (defOf(fv.key)?.displayPosition === 'between-bullet-content') continue
      const def = persistedDefOf(fv.key) ?? synthFieldDef(fv.key, fv.value_type)
      if (isHiddenByRule(def)) continue
      seen.add(fv.key)
      out.push(def)
    }
    return out
  })

  /** 孤儿 key 集合（模板弱区分样式判定用） */
  const orphanKeySet = computed<Set<string>>(() => new Set(orphanFields.value.map((d) => d.key)))

  /**
   * list 变体可见字段 = 标签驱动字段（过隐藏规则）∪ 孤儿字段（过隐藏规则）。
   * 见上方各 computed 说明；孤儿字段不重复计入已声明的标签驱动字段。
   * 成对投影：无有效 status 值 → priority 行隐藏（hasStatusValue，见上方）。
   */
  const fields = computed<PersistedFieldDefinition[]>(() => {
    const tagFields = tagDrivenDefs.value.filter((d) => !isHiddenByRule(d))
    const all = [...tagFields, ...orphanFields.value]
    return hasStatusValue.value ? all : all.filter((d) => d.key !== 'priority')
  })

  return {
    /** 字段区实际渲染行（折叠守卫与渲染条件的共同依据） */
    fields,
    rows,
    persistedDefOf,
    rawValueOf,
    hasStatusValue,
    orphanKeySet,
  }
}
