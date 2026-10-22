import { readFile, writeFile, appendFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function metadata(root = '.', ref = process.env.GITHUB_REF || '') {
  const pkg = await json(path.join(root, 'package.json'));
  const lock = await json(path.join(root, 'package-lock.json'));
  const tauri = await json(path.join(root, 'src-tauri/tauri.conf.json'));
  const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = await readFile(path.join(root, 'src-tauri/Cargo.lock'), 'utf8');
  const packageSection = cargo.split('[package]')[1]?.split(/\r?\n\[/)[0];
  const rustVersion = packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const rustLock = cargoLock.split('[[package]]').find(section => /^name = "aropyt"$/m.test(section));
  const rustLockVersion = rustLock?.match(/^version = "([^"]+)"/m)?.[1];
  const version = pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw Error('Expected a release version such as 1.2.3 or 1.2.3-beta.1');
  }
  if ([lock.version, lock.packages[''].version, tauri.version, rustVersion, rustLockVersion].some(v => v !== version)) {
    throw Error('Version mismatch: package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json must agree');
  }
  const tag = 'v' + version;
  if (ref.startsWith('refs/tags/') && ref !== 'refs/tags/' + tag) throw Error(`Tag ${ref} must match ${tag}`);
  return { version, tag, prerelease: version.includes('-') };
}

export async function assemble(root = '.', commit = process.env.GITHUB_SHA) {
  const { version, tag, prerelease } = await metadata(root);
  commit ||= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const download = path.join(root, 'release/download');
  const output = path.join(root, 'release/publish');
  const groups = [
    ['windows-x64', 'windows', 'win32', `Aropyt_${version}_x64-setup.exe`],
    ['linux-x64-deb', 'linux', 'linux', `Aropyt_${version}_amd64.deb`],
    ['linux-x64-appimage', 'linux', 'linux', `Aropyt_${version}_amd64.AppImage`],
  ];
  const evidence = {};
  const assets = [];
  for (const [label, platform, os, filename] of groups) {
    const directory = path.join(download, `verification-${platform}-x64`, label);
    const result = await json(path.join(directory, 'test-results.json'));
    const meta = await json(path.join(directory, 'metadata.json'));
    const file = path.join(download, `installer-${platform}-x64`, filename);
    const bytes = await readFile(file);
    const digest = sha256(bytes);
    if (meta.commit !== commit || meta.exitCode !== 0 || meta.artifact !== filename || meta.sha256 !== digest ||
        result.arch !== 'x64' || result.platform !== os || !Array.isArray(result.passed) || result.passed.length < 84) {
      throw Error(`Invalid release evidence or artifact hash: ${label}`);
    }
    assets.push({ name: filename, sha256: digest, size: bytes.length, file });
    for (const name of await readdir(directory)) evidence[`${label}/${name}`] = await readFile(path.join(directory, name));
  }
  const manifest = { version, tag, prerelease, commit, assets: assets.map(({ file, ...asset }) => asset) };
  evidence['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const { zipSync } = await import('fflate');
  const archiveName = `Aropyt_${version}_verification.zip`;
  const archive = zipSync(evidence, { level: 6 });
  await mkdir(output, { recursive: true });
  // Validate every platform before writing anything that can be published.
  for (const asset of assets) await copyFile(asset.file, path.join(output, asset.name));
  await writeFile(path.join(output, archiveName), archive);
  const checksums = [...assets, { name: archiveName, sha256: sha256(archive) }];
  await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.map(a => `${a.sha256}  ${a.name}\n`).join(''));
  await writeFile(path.join(output, 'release-notes.md'), `Windows x64 NSIS 与 Docker Linux x64 DEB / AppImage。\n\n三个安装产物分别通过完整 WebView 回归（至少 84 项），覆盖编辑、文件、拼写、Pandoc、PDF/PNG 和多窗口。\n\n附测试证据和 SHA-256 校验。Windows 包未签名；词典按需下载，Pandoc 为可选外部工具。Linux AppImage 在 Docker 中使用 extract-and-run 验证。\n\n源码提交：\`${commit}\`。\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'metadata') {
    const result = await metadata();
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, Object.entries(result).map(([k, v]) => `${k}=${v}\n`).join(''));
    console.log(JSON.stringify(result, null, 2));
  } else if (command === 'assemble') {
    console.log(JSON.stringify(await assemble(), null, 2));
  } else throw Error('Usage: node tools/release.mjs <metadata|assemble>');
}
