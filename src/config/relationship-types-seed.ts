import type { RelationshipType } from '../types/relationship-type'
import seedData from './relationship-types-seed.json'

/**
 * 内置关系类型种子（首启写入 IndexedDB；用户修改后不会被覆盖）。
 * 数据见 relationship-types-seed.json。
 * id 命名规则：`rt_seed_<type>`。
 */
export const RELATIONSHIP_TYPES_SEED: Omit<RelationshipType, 'id' | 'order' | 'createdAt' | 'updatedAt'>[] = seedData as RelationshipType[]
