import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built index.html loads its assets over file:// when
  // Electron opens it directly from disk.
  base: './',
  server: {
    port: 5173,
    // Proxy API calls to the local FocusLock service during development so the
    // UI can use same-origin relative paths.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:47615',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
