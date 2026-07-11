import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import { quasar, transformAssetUrls } from '@quasar/vite-plugin';

const root = fileURLToPath(new URL('.', import.meta.url));
const indexPath = fileURLToPath(new URL('./public/index.html', import.meta.url));

function fingerprintedIndex(): Plugin {
  return {
    name: 'pfxp-fingerprinted-index',
    apply: 'build',
    async writeBundle(_options, bundle) {
      const files = Object.keys(bundle);
      const scripts = files.filter((file) => /^app\.[0-9a-f]{8,}\.js$/.test(file));
      const stylesheets = files.filter((file) => /^app\.[0-9a-f]{8,}\.css$/.test(file));
      if (scripts.length !== 1 || stylesheets.length !== 1) {
        throw new Error(`Expected one fingerprinted app script and stylesheet; found ${scripts.length} and ${stylesheets.length}`);
      }

      const source = await fs.readFile(indexPath, 'utf8');
      const updated = source
        .replace(/\/assets\/app(?:\.[0-9a-f]{8,})?\.css/, `/assets/${stylesheets[0]}`)
        .replace(/\/assets\/app(?:\.[0-9a-f]{8,})?\.js/, `/assets/${scripts[0]}`);
      if (!updated.includes(`/assets/${stylesheets[0]}`) || !updated.includes(`/assets/${scripts[0]}`)) {
        throw new Error('Unable to update fingerprinted asset references in public/index.html');
      }
      await fs.writeFile(indexPath, updated, 'utf8');
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: '/assets/',
  publicDir: false,
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar(),
    fingerprintedIndex(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/client', import.meta.url)),
    },
  },
  build: {
    outDir: `${root}public/assets`,
    emptyOutDir: true,
    sourcemap: mode === 'development',
    cssCodeSplit: false,
    rollupOptions: {
      input: `${root}src/client/main.ts`,
      output: {
        entryFileNames: 'app.[hash].js',
        chunkFileNames: '[name].[hash].js',
        hashCharacters: 'hex',
        assetFileNames: (assetInfo) => assetInfo.names?.some((name) => name.endsWith('.css'))
          ? 'app.[hash][extname]'
          : '[name].[hash][extname]',
      },
    },
  },
}));
