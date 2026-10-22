import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);
await mkdir('dist/dist/renderer', { recursive: true });
await writeFile('dist/native-export.html', '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
for (const file of ['index.html', 'preferences.html']) {
  const html = (await readFile('src/renderer/' + file, 'utf8')).replace('<script src=', '<script src="bridge.js"></script><script src=');
  await writeFile('dist/dist/renderer/' + file, html);
}
await cp('src/renderer/styles', 'dist/dist/renderer/styles', { recursive: true });
await cp('static/media', 'dist/static/media', { recursive: true });
await cp('vendor', 'dist/vendor', { recursive: true, filter: source => !source.includes('vendor/spellcheck') });
await rm('resources/spellcheck', { recursive: true, force: true });
await rm('dist/vendor/spellcheck', { recursive: true, force: true });
await mkdir('resources/styles', { recursive: true });
await cp('vendor/styles', 'resources/styles', { recursive: true });
await cp('src/renderer/styles', 'resources/renderer-styles', { recursive: true });
for (const [entry, key, output] of [['src/shared/defaults.ts', 'DEFAULTS', 'defaults'], ['src/shared/spellcheck.ts', 'SPELL_LANGUAGES', 'spell-languages']]) {
  const build = await esbuild.build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  const data = await import('data:text/javascript;base64,' + Buffer.from(build.outputFiles[0].contents).toString('base64'));
  await writeFile('resources/' + output + '.json', JSON.stringify(data[key], null, 2));
}
const configs = [
  ['src/bridge/index.ts', 'dist/dist/renderer/bridge.js'],
  ['src/renderer/app.ts', 'dist/dist/renderer/app.js'],
  ['src/renderer/preferences.ts', 'dist/dist/renderer/preferences.js'],
].map(([entry, outfile]) => ({ entryPoints: [entry], outfile, bundle: true, platform: 'browser', mainFields: ['browser', 'main', 'module'], format: 'iife', target: ['safari15', 'chrome110', 'firefox115'], sourcemap: watch ? 'inline' : false, minify: !watch, logLevel: 'info' }));
for (const cfg of configs) { if (watch) { const ctx = await esbuild.context(cfg); await ctx.watch(); } else await esbuild.build(cfg); }
console.log('[build] Tauri frontend ready; dictionaries are optional downloads');
