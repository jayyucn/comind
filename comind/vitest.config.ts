import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
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
    setupFiles: ['./tests/setup.ts'],
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext'
      },
      exclude: ['@wasm/comind_wasm']
    }
  }
})
