import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves the app under /<repo>/. Override with VITE_BASE if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/coco/',
  plugins: [vue()],
  test: { environment: 'node' },
})
