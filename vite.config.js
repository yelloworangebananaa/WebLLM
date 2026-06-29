import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(__dirname, 'extension');
const distDir = resolve(__dirname, 'dist');

function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      mkdirSync(distDir, { recursive: true });
      mkdirSync(resolve(distDir, 'inference'), { recursive: true });
      mkdirSync(resolve(distDir, 'transformers'), { recursive: true });

      cpSync(resolve(extensionDir, 'manifest.json'), resolve(distDir, 'manifest.json'));
      cpSync(resolve(extensionDir, 'popup.html'), resolve(distDir, 'popup.html'));
      cpSync(resolve(extensionDir, 'popup.css'), resolve(distDir, 'popup.css'));
      cpSync(
        resolve(extensionDir, 'inference/offscreen.html'),
        resolve(distDir, 'inference/offscreen.html')
      );

      const transformersDist = resolve(__dirname, 'node_modules/@huggingface/transformers/dist');
      const ortDist = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
      if (existsSync(transformersDist)) {
        for (const file of readdirSync(transformersDist)) {
          if (file.endsWith('.wasm') || file.endsWith('.mjs')) {
            cpSync(resolve(transformersDist, file), resolve(distDir, 'transformers', file));
          }
        }
      }
      if (existsSync(ortDist)) {
        for (const file of readdirSync(ortDist)) {
          if (file.startsWith('ort-wasm') && (file.endsWith('.wasm') || file.endsWith('.mjs'))) {
            cpSync(resolve(ortDist, file), resolve(distDir, 'transformers', file));
          }
        }
      }

      const assetsDir = resolve(distDir, 'assets');
      if (existsSync(assetsDir)) {
        for (const file of readdirSync(assetsDir)) {
          if (file.endsWith('.wasm')) {
            const targetName = file.includes('asyncify')
              ? 'ort-wasm-simd-threaded.asyncify.wasm'
              : file.replace(/-[A-Za-z0-9]+\.wasm$/, '.wasm');
            cpSync(resolve(assetsDir, file), resolve(distDir, 'transformers', targetName));
          }
          if (file.endsWith('.mjs') && file.includes('ort-wasm')) {
            cpSync(resolve(assetsDir, file), resolve(distDir, 'transformers', file.replace(/-[A-Za-z0-9]+\.mjs$/, '.mjs')));
          }
        }
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: resolve(extensionDir, 'popup.js'),
        background: resolve(extensionDir, 'inference/background.js'),
        offscreen: resolve(extensionDir, 'inference/offscreen.js'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'inference/background.js';
          if (chunk.name === 'offscreen') return 'inference/offscreen.js';
          return '[name].js';
        },
        chunkFileNames: 'inference/chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    minify: false,
  },
  plugins: [copyExtensionAssets()],
});
