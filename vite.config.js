import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5188,
    allowedHosts: ['wwhnb.wh1234567.com'],
    proxy: {
      // In development, Vite forwards /api requests to our backend server.
      // Backend default port is now 3888 (controlled by PORT env var).
      // Example: cross-env PORT=3888 npm run dev
      '/api': {
        target: `http://localhost:${process.env.PORT || 3888}`,
        changeOrigin: true,
      },
    },
  },
})
