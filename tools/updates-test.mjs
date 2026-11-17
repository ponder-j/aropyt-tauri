import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { macosUpdaterManifest } from './release-macos.mjs';

async function bundle(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { UpdateController } = await bundle('src/renderer/updater.ts');
const { shortcutCombo, shortcutHint, normalizeShortcut } = await bundle('src/shared/shortcuts.ts');

test('Windows Shift punctuation and digits match the keys printed in menus', () => {
  for (const [key, code, expected] of [['+', 'Equal', '='], ['_', 'Minus', '-'], ['~', 'Backquote', '`'], ['{', 'BracketLeft', '['], ['}', 'BracketRight', ']'], ['!', 'Digit1', '1'], ['%', 'Digit5', '5']]) {
    assert.equal(shortcutCombo({ key, code, ctrlKey: true, shiftKey: true }, false), `ctrl+shift+${expected}`);
  }
  assert.equal(shortcutCombo({ key: 'b', code: 'KeyB', ctrlKey: true, isComposing: true }, false), '');
  assert.equal(shortcutCombo({ key: 'b', metaKey: true }, false), '');
  assert.equal(normalizeShortcut('Shift+CommandOrControl+B', false), 'ctrl+shift+b');
  assert.equal(shortcutHint('CommandOrControl+Alt+Shift+B', false), 'Ctrl+Alt+Shift+B');
  assert.equal(shortcutHint('Ctrl+Alt+Shift+B', true), '⌘⌥⇧B');
});

function fixture(overrides = {}) {
  const calls = [], notices = [];
  const responses = { 'update.claimStartup': true, 'update.check': { version: '1.2.0', currentVersion: '1.0.1' },
    'dialog.showMessageBox': { response: 0 }, 'update.download': { received: 20 }, 'document.saveAll': true, 'update.install': true, 'update.clear': true, ...overrides };
  const invoke = async (method, ...args) => { calls.push(method); const result = responses[method]; if (result instanceof Error) throw result; return typeof result === 'function' ? result(...args) : result; };
  return { calls, notices, controller: new UpdateController(invoke, (...args) => notices.push(args)) };
}
test('declining an update never downloads or installs', async () => {
  const f = fixture({ 'dialog.showMessageBox': { response: 1 } }); await f.controller.check();
  assert.deepEqual(f.calls, ['update.check', 'dialog.showMessageBox', 'update.clear']);
});
test('confirmed update downloads, saves all windows, then installs', async () => {
  const f = fixture(); await f.controller.check();
  assert.deepEqual(f.calls, ['update.check', 'dialog.showMessageBox', 'update.download', 'document.saveAll', 'update.install', 'update.clear']);
});
test('cancelled save prevents installation and duplicate checks are suppressed', async () => {
  const f = fixture({ 'document.saveAll': false }); await Promise.all([f.controller.check(), f.controller.check()]);
  assert(!f.calls.includes('update.install')); assert.equal(f.calls.filter(m => m === 'update.check').length, 1);
});
test('bad signature or failed download never closes documents or installs', async () => {
  const f = fixture({ 'update.download': { error: 'Invalid signature' } }); await f.controller.check(false);
  assert(!f.calls.includes('document.saveAll')); assert(!f.calls.includes('update.install'));
  assert(f.notices.some(([text, kind]) => kind === 'error' && text.includes('Invalid signature')));
});
test('automatic network failures are quiet; manual failures are visible', async () => {
  const automatic = fixture({ 'update.check': new Error('offline') }); await automatic.controller.check(false); assert.equal(automatic.notices.length, 0);
  const manual = fixture({ 'update.check': new Error('offline') }); await manual.controller.check(true); assert(manual.notices.some(([, kind]) => kind === 'error'));
});
test('up to date and unclaimed startup do not ask to install', async () => {
  const f = fixture({ 'update.check': null }); await f.controller.check(); assert(!f.calls.includes('dialog.showMessageBox'));
  const secondWindow = fixture({ 'update.claimStartup': false }); await secondWindow.controller.startup(); assert.deepEqual(secondWindow.calls, ['update.claimStartup']);
});

test('a newer build of the same displayed version still offers installation', async () => {
  const f = fixture({ 'update.check': { version: '1.0.1', currentVersion: '1.0.1', build: 2, currentBuild: 1 } });
  await f.controller.check(); assert(f.calls.includes('update.install'));
});

test('macOS manifest binds publication date to the build and uses a revision-specific signed archive', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'aropyt-macos-manifest-'));
  try {
    const build = { build: 1793451600, date: new Date(1793451600000).toISOString() };
    const name = `Aropyt_1.0.1_aarch64_${build.build}.app.tar.gz`;
    await writeFile(path.join(work, name + '.sig'), Buffer.from('untrusted comment: fixture').toString('base64'));
    const manifest = await macosUpdaterManifest(work, build, '1.0.1', 'arm64');
    assert.equal(manifest.pub_date, build.date); assert.equal(manifest.version, '1.0.1');
    assert(manifest.platforms['darwin-aarch64'].url.endsWith('/' + name));
    await assert.rejects(macosUpdaterManifest(work, { ...build, date: '2020-01-01T00:00:00Z' }, '1.0.1', 'arm64'));
  } finally { await rm(work, { recursive: true, force: true }); }
});
