import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Only the app entry. A leftover dist.bak-* /index.html otherwise gets
  // pulled into the dependency scan and can fail the dev server (EPERM).
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/dist/**', '**/dist.bak*/**', '**/node_modules/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8030',
      '/health': 'http://127.0.0.1:8030',
      '/media': 'http://127.0.0.1:8030',
    },
  },
})
