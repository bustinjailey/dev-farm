import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [svelte()],
  server: {
    port: 5173,
    host: true,
    watch: {
      // Ignore files that don't need watching to prevent ENOSPC errors
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/data/**',
        '**/*.log',
        '**/docker/**',
        '**/docs/**',
      ],
    },
    proxy: {
      '/api': 'http://localhost:5000',
      '/create': 'http://localhost:5000',
      '/delete': 'http://localhost:5000',
      '/start': 'http://localhost:5000',
      '/stop': 'http://localhost:5000',
      '/api/stream': {
        target: 'http://localhost:5000',
        ws: false,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
  },
  publicDir: path.resolve(__dirname, 'frontend/public'),
});
