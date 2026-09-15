import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server for `npm run dev` in desktop/: the app window loads it for hot
// reload, and /api is proxied to the backend `desktop_app.py --dev` runs on 8765.
// The packaged app serves the built files from its own backend instead.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
