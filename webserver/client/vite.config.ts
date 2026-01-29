import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // 支持 ~/... 格式（带斜杠）
      { find: /^~\/(.*)$/, replacement: path.resolve(__dirname, 'src') + '/$1' },
      // 支持 ~... 格式（不带斜杠）
      { find: /^~([^/].*)$/, replacement: path.resolve(__dirname, 'src') + '/$1' },
      { find: '@plasmohq/storage/hook', replacement: path.resolve(__dirname, 'src/shims/storage.ts') },
      { find: '@plasmohq/storage', replacement: path.resolve(__dirname, 'src/shims/storage.ts') }
    ]
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  build: {
    outDir: 'dist'
  }
})
