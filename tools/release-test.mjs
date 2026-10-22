import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { metadata, assemble } from './release.mjs';

const commit = 'a'.repeat(40);
async function fixture(t, version = '1.2.3') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aropyt-release-unit-'));
  t.after(async () => {
    assert(path.resolve(root).startsWith(path.join(os.tmpdir(), 'aropyt-release-unit-')));
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'src-tauri'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
  await writeFile(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version }));
  await writeFile(path.join(root, 'src-tauri/Cargo.toml'), `[package]\nname = "aropyt"\nversion = "${version}"\n`);
  await writeFile(path.join(root, 'src-tauri/Cargo.lock'), `[[package]]\nname = "aropyt"\nversion = "${version}"\n`);
  return root;
}

test('tag version and all package/lock versions must agree before building', async t => {
  const root = await fixture(t);
  assert.equal((await metadata(root, 'refs/tags/v1.2.3')).prerelease, false);
  await assert.rejects(metadata(root, 'refs/tags/v1.2.4'), /Tag/);
  await writeFile(path.join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "aropyt"\nversion = "1.2.2"\n');
  await assert.rejects(metadata(root), /Version mismatch/);
});

test('prerelease tags remain distinguishable from stable releases', async t => {
  const root = await fixture(t, '2.0.0-beta.1');
  assert.deepEqual(await metadata(root, 'refs/tags/v2.0.0-beta.1'), { version: '2.0.0-beta.1', tag: 'v2.0.0-beta.1', prerelease: true });
});

test('publication requires all three matching artifacts and evidence from this commit', async t => {
  const root = await fixture(t);
  const groups = [
    ['windows-x64', 'windows', 'win32', 'Aropyt_1.2.3_x64-setup.exe'],
    ['linux-x64-deb', 'linux', 'linux', 'Aropyt_1.2.3_amd64.deb'],
    ['linux-x64-appimage', 'linux', 'linux', 'Aropyt_1.2.3_amd64.AppImage'],
  ];
  for (const [label, platform, osName, filename] of groups) {
    const evidence = path.join(root, `release/download/verification-${platform}-x64`, label);
    const installers = path.join(root, `release/download/installer-${platform}-x64`);
    await mkdir(evidence, { recursive: true }); await mkdir(installers, { recursive: true });
    const bytes = Buffer.from(filename);
    await writeFile(path.join(installers, filename), bytes);
    await writeFile(path.join(evidence, 'test-results.json'), JSON.stringify({ platform: osName, arch: 'x64', passed: Array(84).fill('pass') }));
    await writeFile(path.join(evidence, 'metadata.json'), JSON.stringify({ commit, exitCode: 0, artifact: filename, sha256: createHash('sha256').update(bytes).digest('hex') }));
  }
  await assert.rejects(assemble(root, 'b'.repeat(40)), /Invalid release evidence/);
  await assert.rejects(access(path.join(root, 'release/publish')));
  const appimage = path.join(root, 'release/download/installer-linux-x64/Aropyt_1.2.3_amd64.AppImage');
  const original = await readFile(appimage);
  await writeFile(appimage, 'tampered package');
  await assert.rejects(assemble(root, commit), /Invalid release evidence/);
  await assert.rejects(access(path.join(root, 'release/publish')));
  await writeFile(appimage, original);
  const resultFile = path.join(root, 'release/download/verification-linux-x64/linux-x64-deb/test-results.json');
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  await writeFile(resultFile, JSON.stringify({ ...result, passed: result.passed.slice(0, 83) }));
  await assert.rejects(assemble(root, commit), /Invalid release evidence/);
  await writeFile(resultFile, JSON.stringify(result));
  await assemble(root, commit);
  const sums = await readFile(path.join(root, 'release/publish/SHA256SUMS.txt'), 'utf8');
  assert.equal(sums.trim().split('\n').length, 4);
  for (const line of sums.trim().split('\n')) {
    const [digest, filename] = line.split('  ');
    assert.equal(createHash('sha256').update(await readFile(path.join(root, 'release/publish', filename))).digest('hex'), digest);
  }
});
