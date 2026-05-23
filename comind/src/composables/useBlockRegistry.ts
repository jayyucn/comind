import type { BlockTypeHandler } from '../types/block-type'

const registry = new Map<string, BlockTypeHandler>()

export function useBlockRegistry() {
  function register(handler: BlockTypeHandler) {
    if (registry.has(handler.type)) {
      return
    }
    registry.set(handler.type, handler)
  }

  function getHandler(type: string): BlockTypeHandler | undefined {
    return registry.get(type)
  }

  function getRegisteredTypes(): string[] {
    return Array.from(registry.keys())
  }

  return { register, getHandler, getRegisteredTypes }
}