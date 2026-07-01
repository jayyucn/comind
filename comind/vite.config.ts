import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [vue(), wasm(), topLevelAwait()],
  server: {
    allowedHosts: true
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    },
    exclude: ['@wasm/comind_wasm']
  },
  build: {
    target: 'esnext'
  },
  resolve: {
    alias: {
      '@': '/src',
      '@wasm': '/crates/pkg'
    }
  }
})
