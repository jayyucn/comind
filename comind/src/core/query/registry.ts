/**
 * 字段描述符注册表 —— 无头核心，纯 TS，不依赖 Vue / Pinia。
 *
 * 按 entityType 命名空间隔离各业务实体的可筛字段；支持运行时增删（用于 Block
 * 用户自定义 property 这类动态字段）；通过 subscribe 暴露响应式订阅，供 Vue 层
 * 包装成响应式后让 FilterBuilder 自动跟随字段变化。
 */
import type { FieldDescriptor } from './types'

/** 注册表订阅回调：注册表任意变化后触发，无参数。 */
export type RegistryListener = () => void

/** 字段描述符注册表接口（headless，与框架无关）。 */
export interface Registry {
  /** 在指定 entityType 命名空间注册字段；同 key 覆盖旧值。 */
  register(entityType: string, descriptor: FieldDescriptor): void
  /** 从指定 entityType 命名空间移除字段；不存在的 key 安全无副作用。 */
  unregister(entityType: string, key: string): void
  /** 列出指定 entityType 的全部字段（返回快照拷贝）。 */
  list(entityType: string): FieldDescriptor[]
  /** 按 entityType + key 精确取字段描述符；不存在返回 undefined。 */
  get(entityType: string, key: string): FieldDescriptor | undefined
  /** 订阅注册表变化，返回取消订阅函数。 */
  subscribe(listener: RegistryListener): () => void
}

/**
 * 创建一个显式注册表实例（非全局单例）。
 *
 * 测试可自行实例化以隔离；业务在组合根创建并注册全部字段。
 */
export function createRegistry(): Registry {
  /** entityType -> (key -> descriptor) */
  const namespaces = new Map<string, Map<string, FieldDescriptor>>()
  const listeners = new Set<RegistryListener>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const ns = (entityType: string): Map<string, FieldDescriptor> => {
    let space = namespaces.get(entityType)
    if (!space) {
      space = new Map()
      namespaces.set(entityType, space)
    }
    return space
  }

  return {
    register(entityType, descriptor) {
      ns(entityType).set(descriptor.key, descriptor)
      notify()
    },

    unregister(entityType, key) {
      const space = namespaces.get(entityType)
      if (space?.delete(key)) notify()
    },

    list(entityType) {
      const space = namespaces.get(entityType)
      return space ? [...space.values()] : []
    },

    get(entityType, key) {
      return namespaces.get(entityType)?.get(key)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
