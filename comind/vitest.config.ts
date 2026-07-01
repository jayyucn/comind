import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': '/src',
      '@wasm': '/crates/pkg'
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test-*.spec.ts'],
    globals: true,
    setupFiles: ['./tests/setup.ts']
  }
})
