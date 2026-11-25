import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.PDF_RELEASE_WORKDIR;
const directory = path.join(base, 'mac-local', 'artifacts');
const inventory = JSON.parse(await readFile(path.join(import.meta.dirname, 'mac-transport-inventory.json'), 'utf8'));
const live = JSON.parse(await readFile(path.join(base, 'previous-release', 'live.json'), 'utf8'));
const transport = 'pdf-links-input-bb45f87--';
const expected = Object.entries(inventory);
assert.equal(live.id, 421408145);
assert.equal(expected.length, 4);
assert.equal(live.assets.filter(asset => asset.name.startsWith(transport)).length, expected.length);
for (const [canonical, file] of expected) {
  const asset = live.assets.find(asset => asset.name === file.name);
  assert.equal(asset.digest, 'sha256:' + file.sha256, canonical);
  assert.equal(asset.size, file.size, canonical);
  const staged = path.join(directory, file.name);
  const bytes = await readFile(staged);
  assert.equal(bytes.length, file.size, canonical);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, canonical);
  await rename(staged, path.join(directory, canonical));
}
assert.equal(live.assets.length - expected.length, 17);
live.assets = live.assets.filter(asset => !asset.name.startsWith(transport));
await writeFile(path.join(base, 'previous-release', 'release.json'), JSON.stringify(live));
