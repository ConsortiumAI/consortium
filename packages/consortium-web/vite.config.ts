import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['libsodium-wrappers'],
  },
  resolve: {
    alias: {
      // Force CJS build of libsodium-wrappers (ESM build has broken imports)
      'libsodium-wrappers': resolve(__dirname, '../../node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
