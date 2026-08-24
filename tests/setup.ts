import { initTestCore } from './core-client'
import { beforeAll } from 'vitest'

beforeAll(async () => {
  await initTestCore()
}, 30000)