import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [label, binary, artifact] = process.argv.slice(2);
if (!['windows-x64', 'linux-x64-deb', 'linux-x64-appimage'].includes(label) || !binary || !artifact) {
  throw Error('Usage: node tools/verify-packaged.mjs <platform-label> <binary> <installer>');
}
const output = path.join('release/verification', label);
await mkdir(output, { recursive: true });
await rm('release/verification/test-results.json', { force: true });
const log = createWriteStream(path.join(output, 'tests.log'));
const child = spawn(process.execPath, ['tools/test-tauri.mjs', '--packaged'], {
  env: { ...process.env, AROPYT_TEST_BINARY: path.resolve(binary) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', bytes => { process.stdout.write(bytes); log.write(bytes); });
}
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
await new Promise(resolve => log.end(resolve));
if (code !== 0) process.exit(code || 1);
const result = JSON.parse(await readFile('release/verification/test-results.json', 'utf8'));
if (result.arch !== 'x64' || result.platform !== process.platform || result.passed.length < 84) {
  throw Error('Incomplete or wrong-platform packaged regression results');
}
for (const name of ['test-results.json', 'export.pdf', 'export.png', 'export.html', 'long-export.pdf']) {
  await copyFile(path.join('release/verification', name), path.join(output, name));
}
await writeFile(path.join(output, 'metadata.json'), JSON.stringify({
  commit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  artifact: path.basename(artifact),
  sha256: createHash('sha256').update(await readFile(artifact)).digest('hex'),
  binary: path.resolve(binary),
  exitCode: code,
}, null, 2) + '\n');
