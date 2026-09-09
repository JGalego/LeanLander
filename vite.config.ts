import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const tauriHost = process.env.TAURI_DEV_HOST

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  server: {
    host: tauriHost ?? false,
    port: 1420,
    strictPort: true,
    hmr: tauriHost
      ? {
          protocol: 'ws',
          host: tauriHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
