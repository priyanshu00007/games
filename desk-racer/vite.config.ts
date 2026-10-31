import fs from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const GSTATIC_MODELS_BASE = 'https://www.gstatic.com/aistudio/starter-apps/desk-racer/models';
const GLB_FILES = [
  'desk_props.glb',
  'kart_1to87.glb',
  'room_environment.glb',
  'track_coaster.glb',
];

function fetchGstaticModelsOnBuild(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fetch-gstatic-models-on-build',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    async closeBundle() {
      // Only /assets/models is written: main.js tries that URL first, so a
      // second copy under /api/gstatic-models would double dist size (~14 MB)
      // without ever being fetched in production.
      const assetsModelsDir = path.resolve(outDir, 'assets/models');
      await fs.mkdir(assetsModelsDir, { recursive: true });

      await Promise.all(
        GLB_FILES.map(async (file) => {
          const url = `${GSTATIC_MODELS_BASE}/${file}`;
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          await fs.writeFile(path.join(assetsModelsDir, file), buffer);
        })
      );
    },
  };
}

const gstaticModelsProxy = {
  '/api/gstatic-models': {
    target: 'https://www.gstatic.com',
    changeOrigin: true,
    rewrite: (reqPath: string) =>
      reqPath.replace(/^\/api\/gstatic-models/, '/aistudio/starter-apps/desk-racer/models'),
  },
  '/assets/models': {
    target: 'https://www.gstatic.com',
    changeOrigin: true,
    rewrite: (reqPath: string) =>
      reqPath.replace(/^\/assets\/models/, '/aistudio/starter-apps/desk-racer/models'),
  },
};

export default defineConfig({
  plugins: [fetchGstaticModelsOnBuild()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: gstaticModelsProxy,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    proxy: gstaticModelsProxy,
  },
});
