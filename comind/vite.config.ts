import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  server: {
    allowedHosts: true
  },
  optimizeDeps: {
    exclude: ['@wasm/comind_wasm']
  },
  build: {
    target: 'esnext'
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@wasm': fileURLToPath(new URL('./crates/pkg', import.meta.url))
    }
  }
})
