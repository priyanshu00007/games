import { defineConfig } from 'vite';

const PORT = Number(process.env.MEETMAP_WEB_PORT) || 5179;
const API_PORT = Number(process.env.MEETMAP_API_PORT) || 3100;

export default defineConfig({
  server: {
    port: PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
