import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(__dirname, 'frontend'),
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'frontend/src') }
  },
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/output': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
})
