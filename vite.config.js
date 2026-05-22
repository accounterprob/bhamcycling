import { defineConfig } from 'vite'

// Relative base so the same build works on any GitHub Pages path
// (e.g. https://you.github.io/repo-name/) without rebuilding.
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173
  },
  build: {
    target: 'es2020',
    sourcemap: false
  }
})
