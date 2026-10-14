// Vite can't emit IIFE for multiple inputs, so background and content are
// separate single-file IIFE builds; popup and offscreen pages build together.
import { build } from 'vite';

const watch = process.argv.includes('--watch');
const common = { root: 'src', publicDir: '../public', logLevel: 'warn' };
const out = (first) => ({ outDir: '../dist', emptyOutDir: first, copyPublicDir: first, watch: watch ? {} : null, minify: false });
const iife = (name, first) => ({
  ...common,
  publicDir: first ? common.publicDir : false,
  build: {
    ...out(first),
    lib: { entry: `${name}.ts`, formats: ['iife'], name: `svs_${name}`, fileName: () => `${name}.js` },
  },
});

await build(iife('background', true));
await build(iife('content', false));
await build({
  ...common,
  publicDir: false,
  base: './',
  build: {
    ...out(false),
    rollupOptions: { input: { popup: 'src/popup/popup.html', offscreen: 'src/offscreen/offscreen.html' } },
  },
});
