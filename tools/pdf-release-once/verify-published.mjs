import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.PDF_RELEASE_WORKDIR;
const live = JSON.parse(await readFile(path.join(base, 'published.json'), 'utf8'));
const checksumBytes = await readFile(path.join(base, 'publish', 'SHA256SUMS.txt'));
const entries = String(checksumBytes).trim().split('\n').map(line => line.split('  '));
entries.push([createHash('sha256').update(checksumBytes).digest('hex'), 'SHA256SUMS.txt']);
assert.equal(live.id, 421408145);
assert.equal(live.tag_name, 'v1.0.1');
assert.equal(live.draft, false);
assert(live.body.includes('PDF 相对链接修复（2026-11-25）'));
assert.equal(live.assets.length, entries.length);
for (const [hash, name] of entries) {
  assert.equal(live.assets.find(asset => asset.name === name)?.digest, 'sha256:' + hash, name);
}
console.log('Verified ' + entries.length + ' published release assets: ' + live.html_url);
