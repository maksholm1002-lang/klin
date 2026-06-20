import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: ['es2019', 'safari14'],
    cssTarget: 'safari14',
  },
  esbuild: {
    target: 'es2019',
  },
})
