/**
 * Vitest 测试设置文件
 *
 * 在所有测试运行前初始化 Core 层。
 */

import { initCore } from '../src/core'
import { beforeAll } from 'vitest'

beforeAll(async () => {
  // 使用 Memory Adapter 进行测试，避免 IndexedDB 在测试环境中的问题
  await initCore('memory')
}, 30000) // 增加超时时间，因为初始化可能需要更长时间
