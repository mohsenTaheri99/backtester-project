import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API base is same-origin: /api is proxied to the backend container,
// so the browser never needs to know the backend's address.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: { usePolling: true }, // needed for bind mounts on Windows/WSL
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})
