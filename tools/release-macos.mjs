import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { metadata } from './release.mjs';

export async function macosUpdaterManifest(directory, build, version, arch = process.arch, repository = 'ponder-j/aropyt-tauri') {
  if (!['arm64', 'x64'].includes(arch) || !Number.isSafeInteger(build.build) || build.build <= 0
    || Date.parse(build.date) !== build.build * 1000) throw Error('Invalid macOS build identity');
  const target = arch === 'arm64' ? 'aarch64' : 'x86_64';
  const name = `Aropyt_${version}_${target}_${build.build}.app.tar.gz`;
  const signature = (await readFile(path.join(directory, name + '.sig'), 'utf8')).trim();
  if (!Buffer.from(signature, 'base64').toString().startsWith('untrusted comment:')) throw Error('Invalid macOS updater signature');
  return { version, pub_date: build.date, build: build.build,
    notes: '支持 macOS 应用内更新，保留快捷键修复。安装前保存所有文稿，完成后自动重新打开。',
    platforms: { [`darwin-${target}`]: { signature, url: `https://github.com/${repository}/releases/download/v${version}/${name}` } } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.platform !== 'darwin') throw Error('macOS release requires macOS');
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY || path.join(homedir(), '.tauri/aropyt-macos-updater.key');
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) await access(key);
  const config = JSON.parse(await readFile('src-tauri/tauri.macos.conf.json', 'utf8'));
  const publicKey = process.env.TAURI_SIGNING_PRIVATE_KEY ? null : (await readFile(key + '.pub', 'utf8')).trim();
  if (publicKey && publicKey !== config.plugins.updater.pubkey) throw Error('The signing key does not match the installed macOS updater public key');
  const { version } = await metadata();
  const previous = JSON.parse(await readFile('src-tauri/updater-build.json', 'utf8'));
  const stamp = Math.max(Math.floor(Date.now() / 1000), previous.build + 1);
  const build = { build: stamp, date: new Date(stamp * 1000).toISOString().replace('.000Z', 'Z') };
  await writeFile('src-tauri/updater-build.json', JSON.stringify(build, null, 2) + '\n');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/tauri.mjs', 'build', '--bundles', 'app,dmg', '--config', JSON.stringify({ bundle: { createUpdaterArtifacts: true } }), '--ci', '--', '--locked'],
      { stdio: 'inherit', env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' } });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('macOS release failed: ' + code)));
  });
  const output = 'release/macos-updater/artifacts'; await mkdir(output, { recursive: true });
  const name = `Aropyt_${version}_${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}_${stamp}.app.tar.gz`;
  for (const suffix of ['', '.sig']) await copyFile(`src-tauri/target/release/bundle/macos/Aropyt.app.tar.gz${suffix}`, path.join(output, name + suffix));
  await copyFile(`src-tauri/target/release/bundle/dmg/Aropyt_${version}_${process.arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`, path.join(output, `Aropyt_${version}_${process.arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`));
  await writeFile(path.join(output, 'latest-macos.json'), JSON.stringify(await macosUpdaterManifest(output, build, version), null, 2) + '\n');
  console.log(`macOS ${version}, build ${stamp}: ${output}`);
}
