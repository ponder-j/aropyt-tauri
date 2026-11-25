import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = path.dirname(import.meta.filename);
const { unzipSync, zipSync, strFromU8 } = createRequire(path.join(base, 'desktop', 'package.json'))('fflate');
const read = (...names) => readFile(path.join(base, ...names));
const parse = bytes => JSON.parse(Buffer.from(bytes).toString());
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => writeFile(path.join(base, 'publish', name), value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const archiveName = 'Aropyt_1.0.1_verification.zip';
const win = 'Aropyt_1.0.1_x64-setup.exe';
const mac = 'Aropyt_1.0.1_aarch64.dmg';
const desktopCommit = 'cf34096e3c531f96baa50f7e8306aa8d3b112901';
const macCommit = 'bb45f8757885b1cc5a7ffcc44f4d35ccf57da2fa';
const runLink = id => 'https://github.com/ponder-j/aropyt-tauri/actions/runs/' + id;
const commitLink = sha => 'https://github.com/ponder-j/aropyt-tauri/commit/' + sha;
const notes = '修复 PDF 导出的相对链接。链接保留原始相对路径及 # 片段。';

const previous = parse(await read('previous-release', 'release.json'));
assert.equal(previous.tag_name, 'v1.0.1');
assert.equal(previous.immutable, false);
assert.equal(previous.draft, false);
const previousArchive = await read('verified-rollback', archiveName);
assert.equal('sha256:' + hash(previousArchive), previous.assets.find(asset => asset.name === archiveName).digest);
const evidence = unzipSync(previousArchive);
evidence['pdf-link-fix/previous-manifest.json'] = evidence['manifest.json'];
const x64 = unzipSync(await read('x64-ci', archiveName));
const macManifest = parse(await read('mac-local', 'artifacts', 'latest-macos.json'));
const oldMacBytes = await read('verified-rollback', 'latest-macos.json');
assert.equal('sha256:' + hash(oldMacBytes), previous.assets.find(asset => asset.name === 'latest-macos.json').digest);
const oldMac = parse(oldMacBytes);
assert.equal(macManifest.version, '1.0.1');
assert(macManifest.build > oldMac.build);
const macUpdater = path.basename(new URL(macManifest.platforms['darwin-aarch64'].url).pathname);
assert.equal(macUpdater, 'Aropyt_1.0.1_aarch64_' + macManifest.build + '.app.tar.gz');
assert.equal(macManifest.platforms['darwin-aarch64'].signature, String(await read('mac-local', 'artifacts', macUpdater + '.sig')).trim());
macManifest.notes = notes;
const winManifest = parse(await read('x64-ci', 'latest.json'));
assert.equal(winManifest.version, '1.0.1');
assert(winManifest.platforms['windows-x86_64'].url.endsWith('/v1.0.1/' + win));
assert.equal(winManifest.platforms['windows-x86_64'].signature, String(await read('x64-ci', win + '.sig')).trim());
winManifest.notes = notes;

await mkdir(path.join(base, 'publish'), { recursive: true });
const assets = [];
for (const [name, label, platform, arch, source] of [
  [win, 'windows-x64', 'win32', 'x64', ['x64-ci']],
  ['Aropyt_1.0.1_amd64.deb', 'linux-x64-deb', 'linux', 'x64', ['x64-ci']],
  ['Aropyt_1.0.1_amd64.AppImage', 'linux-x64-appimage', 'linux', 'x64', ['x64-ci']],
  ['Aropyt_1.0.1_arm64.deb', 'linux-arm64-deb', 'linux', 'arm64', ['arm-ci', 'installer-linux-arm64']],
  ['Aropyt_1.0.1_aarch64.AppImage', 'linux-arm64-appimage', 'linux', 'arm64', ['arm-ci', 'installer-linux-arm64']],
  [mac, 'macos-arm64', 'darwin', 'arm64', ['mac-local', 'artifacts']],
]) {
  const bytes = await read(...source, name);
  const sha256 = hash(bytes);
  let verification;
  let metadata;
  if (source[0] === 'x64-ci') {
    metadata = parse(x64[label + '/metadata.json']);
    verification = parse(x64[label + '/test-results.json']);
    for (const [file, data] of Object.entries(x64)) if (file.startsWith(label + '/')) evidence['pdf-link-fix/' + file] = data;
  } else if (platform === 'linux') {
    const directory = ['arm-ci', 'verification-linux-arm64', label];
    metadata = parse(await read(...directory, 'metadata.json'));
    verification = parse(await read(...directory, 'test-results.json'));
    for (const file of await readdir(path.join(base, ...directory))) evidence['pdf-link-fix/' + label + '/' + file] = await read(...directory, file);
  } else {
    const directory = ['mac-local', 'verification-macos-15'];
    metadata = parse(await read('mac-local', 'installed-check.json'));
    verification = parse(await read(...directory, 'test-results.json'));
    const ciRoot = path.join(base, ...directory);
    for (const entry of await readdir(ciRoot, {withFileTypes: true, recursive: true})) {
      if (!entry.isFile()) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      const filename = path.relative(ciRoot, absolute).split(path.sep).join('/');
      evidence['pdf-link-fix/' + label + '/ci/' + filename] = await readFile(absolute);
    }
    evidence['pdf-link-fix/' + label + '/installed-check.json'] = Buffer.from(json(metadata));
    const updaterChecks = await read('mac-local', 'updater-results.json');
    assert(parse(updaterChecks).passed.length >= 8, 'Mac updater validation did not finish');
    evidence['pdf-link-fix/' + label + '/updater-results.json'] = updaterChecks;
  }
  const commit = platform === 'darwin' ? macCommit : desktopCommit;
  assert.equal(metadata.commit, commit, label);
  assert.equal(metadata.sha256, sha256, label);
  assert.equal(metadata.artifact, name, label);
  assert.equal(metadata.exitCode, 0, label);
  assert.equal(verification.platform, platform, label);
  assert.equal(verification.arch, arch, label);
  assert(verification.passed.length >= 84, label);
  if (platform !== 'linux') assert(verification.passed.some(check => check.startsWith('PDF annotations preserve')), label);
  assets.push({ name, label, platform, arch, commit, size: bytes.length, sha256, checks: verification.passed.length });
  await write(name, bytes);
}

const ci = { main: runLink(45419402345), desktop: runLink(45417903674), macos: runLink(45417902440), x64Release: runLink(45418016710), arm64Release: runLink(45419209233) };
const checksums = new Map(previous.assets.filter(asset => asset.name !== 'SHA256SUMS.txt').map(asset => [asset.name, asset.digest.replace(/^sha256:/, '')]));
for (const asset of assets) checksums.set(asset.name, asset.sha256);
async function writeChecked(name, bytes) {
  await write(name, bytes);
  checksums.set(name, hash(bytes));
}
for (const [name, directory] of [[win + '.sig', ['x64-ci']], [macUpdater, ['mac-local', 'artifacts']], [macUpdater + '.sig', ['mac-local', 'artifacts']]]) {
  await writeChecked(name, await read(...directory, name));
}
await writeChecked('latest.json', json(winManifest));
await writeChecked('latest-macos.json', json(macManifest));
const updaterAssets = [win + '.sig', 'latest.json', macUpdater, macUpdater + '.sig', 'latest-macos.json'].map(name => ({ name, sha256: checksums.get(name) }));
const manifest = { version: '1.0.1', tag: 'v1.0.1', date: new Date().toISOString(), assets, ci, macOSBuild: macManifest.build, updaterAssets };
evidence['manifest.json'] = Buffer.from(json(manifest));
evidence['pdf-link-fix/README.md'] = Buffer.from('本次验证记录位于 pdf-link-fix/。根目录的旧平台记录为此前发布的历史证据。\n');
await writeChecked(archiveName, zipSync(evidence, { level: 6 }));
await write('SHA256SUMS.txt', [...checksums.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([name, sha]) => sha + '  ' + name).join('\n') + '\n');

const releaseNotes = [
  previous.body.trimEnd(), '', '## PDF 相对链接修复（2026-11-25）', '',
  '已覆盖发布 Windows x64、macOS ARM64、Linux x64 和 Linux ARM64 的安装包，版本仍为 **1.0.1**。Windows 和 macOS 导出的 PDF 保留 Markdown 的相对链接及片段，两端均已使用正式安装验证。', '',
  ...assets.map(asset => '- ' + asset.name + '：' + asset.checks + ' 项应用回归通过。'), '',
  '源码与验证：[Windows/Linux ' + desktopCommit.slice(0, 7) + '](' + commitLink(desktopCommit) + ') · [macOS ' + macCommit.slice(0, 7) + '](' + commitLink(macCommit) + ') · [主分支 CI](' + ci.main + ') · [macOS CI](' + ci.macos + ') · [Windows/Linux x64 打包 CI](' + ci.x64Release + ') · [Linux ARM64 打包 CI](' + ci.arm64Release + ')', '',
  'Windows 和 macOS 的签名更新清单以及 SHA-256 校验文件已更新。已安装 1.0.1 的 Windows/Linux 用户可重新下载安装包覆盖安装。', '',
].join('\n');
await writeFile(path.join(base, 'release-notes.md'), releaseNotes);
await writeFile(path.join(base, 'publication-plan.json'), json({ order: [...assets.map(asset => asset.name), win + '.sig', 'latest.json', 'latest-macos.json', archiveName, 'SHA256SUMS.txt'] }));
console.log(json(manifest));
