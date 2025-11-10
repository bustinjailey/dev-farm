import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [
    svelte({
      onwarn: (warning, handler) => {
        // Suppress event_directive_deprecated warnings during build
        // These are for migration to Svelte 5 event handlers (on:click -> onclick)
        // Can be addressed in a dedicated migration task
        if (warning.code === 'event_directive_deprecated') return;
        handler(warning);
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    watch: {
      // Aggressive ignore list to prevent ENOSPC errors
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/data/**',
        '**/*.log',
        '**/docker/**',
        '**/docs/**',
        '**/.config/**',
        '**/test-results/**',
        '**/playwright-report/**',
        '**/coverage/**',
        '**/.vscode/**',
        '**/.idea/**',
        '**/tmp/**',
        '**/temp/**',
        '**/.DS_Store',
        '**/Thumbs.db',
        // Ignore parent workspace node_modules
        '../../node_modules/**',
        '../node_modules/**',
      ],
      // Use native watching for best performance
      usePolling: false,
      // Reduce file watch depth
      depth: 2, // Reduced from 3
    },
    fs: {
      strict: false, // Allow serving files outside root
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
      '/terminal': {
        target: 'http://localhost:5000',
        ws: true,
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
