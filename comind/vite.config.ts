import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 放行你的域名
    allowedHosts: ["comind.jayyu.cn"]
    // 如需全部放行：allowedHosts: "all"
  }
})
