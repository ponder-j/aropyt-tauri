import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { updaterManifest } from './updater-manifest.mjs';

const [binaryArg, installerArg, mode] = process.argv.slice(2);
if (process.platform !== 'win32' || !binaryArg || !installerArg) throw Error('Usage: node tools/test-updater.mjs <isolated-installed-binary> <signed-installer> [--install]');
const binary = path.resolve(binaryArg), installer = path.resolve(installerArg);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const work = await mkdtemp(path.join(tmpdir(), 'aropyt-updater-test-'));
const file = path.join(work, 'update-fixture.md'); await writeFile(file, '# Update fixture\n');
const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; await new Promise(resolve => server.close(resolve));
const token = randomBytes(32).toString('hex');
const expectedHash = createHash('sha256').update(await readFile(binary)).digest('hex');
const child = spawn(binary, [file], { env: { ...process.env, AROPYT_DATA_DIR: path.join(work, 'profile'), AROPYT_TEST_PORT: String(port), AROPYT_TEST_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs += data; });
let windowLabel;
const call = async payload => {
  const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ window: windowLabel, ...payload }), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); if (!result.ok) throw Error(result.error); return result.value;
};
const invoke = (method, ...args) => call({ op: 'invoke', method, args });
const wait = async fn => { const end = Date.now() + 90000; let last; while (Date.now() < end) { try { if (await fn()) return; } catch (error) { last = error; } await new Promise(resolve => setTimeout(resolve, 200)); } throw Error('Updater smoke test timeout: ' + last); };
const passed = [], pass = text => { passed.push(text); console.log('PASS ' + text); };
try {
  await wait(() => call({ code: 'Boolean(window.__aropyt)' }));
  windowLabel = (await call({ op: 'windows' })).find(label => label.startsWith('editor-'));
  // check() also initializes the plugin's TLS provider before a restored test
  // fixture is allowed to download. A manifest may not be published yet.
  if (mode === '--install') await invoke('update.check').catch(() => {});
  const latest = await updaterManifest(path.dirname(installer), version);
  const [major, minor, patch] = version.split('.').map(Number);
  const newer = { ...latest, version: `${major}.${minor}.${patch + 1}` };
  assert.equal(await call({ op: 'update-fixture', manifest: latest, file: installer }), null);
  assert.equal(await call({ op: 'update-fixture', manifest: { ...latest, version: '0.0.1' }, file: installer }), null);
  await assert.rejects(call({ op: 'update-fixture', manifest: newer, file: installer, stage: true }), /version|版本|tampered/);
  assert.equal((await call({ op: 'update-fixture', manifest: latest, file: installer, stage: true })).verified, true);
  pass('Real updater verifies the signed release, ignores current/older versions and rejects a falsified version');
  const tampered = path.join(work, 'tampered.exe'); const bytes = Buffer.from(await readFile(installer)); bytes[bytes.length - 1] ^= 1; await writeFile(tampered, bytes);
  await assert.rejects(call({ op: 'update-fixture', manifest: latest, file: tampered, stage: true }));
  await assert.rejects(call({ op: 'update-fixture', manifest: { ...latest, platforms: { 'windows-x86_64': { ...latest.platforms['windows-x86_64'], signature: 'invalid' } } }, file: installer, stage: true }));
  pass('Real signature verifier rejects a modified installer and invalid signature');
  await invoke('bridge.send', 'doc.syncChange', { dirty: true });
  await assert.rejects(invoke('update.install'), /unsaved|未保存/);
  const second = await call({ op: 'new' });
  await assert.rejects(call({ op: 'invoke', window: second, method: 'update.clear', args: [] }), /Another window|另一窗口/);
  await invoke('bridge.send', 'doc.syncChange', { dirty: false });
  await call({ op: 'invoke', window: second, method: 'app.onCloseWin', args: [] });
  pass('Native install guard preserves unsaved windows and another window cannot replace the pending update');
  if (mode === '--install') {
    // Runs only against the temporary installation made by verify-windows-installer.ps1.
    assert(binary.startsWith(path.join(tmpdir(), 'aropyt-release-')));
    await invoke('update.download');
    pass('Updater downloads and verifies the actual Windows installer from GitHub');
    const exited = new Promise(resolve => child.once('exit', resolve));
    await invoke('update.install').catch(() => {});
    let timeout;
    try { await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Installer did not close the running app')), 60000); })]); }
    finally { clearTimeout(timeout); }
    windowLabel = undefined;
    await wait(() => call({ code: 'Boolean(window.__aropyt)' }));
    assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'), expectedHash);
    assert.equal(await call({ code: 'window.__aropyt.state.file' }), file);
    pass('NSIS overwrites the existing installation, restarts Aropyt and reopens the document');
  }
  await writeFile('release/verification/windows-x64/updater-results.json', JSON.stringify({ version, date: new Date().toISOString(), passed }, null, 2));
} finally {
  await writeFile('release/verification/windows-x64/updater-app.log', logs);
  await call({ op: 'quit' }).catch(() => {}); if (child.exitCode === null) child.kill();
}
