// Vite can't emit IIFE for multiple inputs, so background and the content scripts are
// separate single-file IIFE builds; popup and offscreen pages build together.
import { build } from 'vite';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
// --firefox: same code into dist-firefox/ without tab capture (no offscreen document there), with a Firefox manifest
const firefox = process.argv.includes('--firefox');
const dir = firefox ? 'dist-firefox' : 'dist';
const common = { root: 'src', publicDir: '../public', logLevel: 'warn' };
const out = (first) => ({ outDir: `../${dir}`, emptyOutDir: first, copyPublicDir: first, watch: watch ? {} : null, minify: false });
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
await build(iife('inject', false));
await build({
  ...common,
  publicDir: false,
  base: './',
  build: {
    ...out(false),
    target: 'es2022', // top-level await in the pages
    rollupOptions: { input: { popup: 'src/popup/popup.html', ...(firefox ? {} : { offscreen: 'src/offscreen/offscreen.html' }), options: 'src/options/options.html' } },
  },
});

if (firefox) {
  const file = `${dir}/manifest.json`;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  m.permissions = m.permissions.filter((p) => p !== 'tabCapture' && p !== 'offscreen');
  m.background = { scripts: ['background.js'] }; // Firefox runs MV3 background code as an event page, not a service worker
  m.browser_specific_settings = { gecko: { id: 'volume-lock@kaandinc.com', strict_min_version: '128.0' } }; // 128: content scripts in the MAIN world
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
  rmSync(`${dir}/offscreen`, { recursive: true, force: true });
}
