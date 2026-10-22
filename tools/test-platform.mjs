import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const work = await mkdtemp(path.join(os.tmpdir(), 'aropyt-platform-'));
try {
  await build({ entryPoints: ['src/shared/local-files.ts', 'src/main/launch.ts'], outbase: 'src', outdir: work, bundle: true, platform: 'node', format: 'cjs' });
  const { localFileUrl, imageFileReference } = require(path.join(work, 'shared/local-files.js'));
  const { launchFiles } = require(path.join(work, 'main/launch.js'));
  const document = path.join(work, '中文 folder', '文稿.MD');
  await mkdir(path.dirname(document)); await writeFile(document, '# Test\r\n');
  const asset = path.join(path.dirname(document), '图片 # 100% (1).png');
  const encoded = '%E5%9B%BE%E7%89%87%20%23%20100%25%20%281%29.png';
  assert.equal(localFileUrl(encoded, document), pathToFileURL(asset).href);
  assert.equal(localFileUrl('../中文 folder/' + encoded, document), pathToFileURL(asset).href);
  assert.equal(localFileUrl(asset), pathToFileURL(asset).href);
  const literalPercent = path.join(work, 'literal%20name.png');
  assert.equal(localFileUrl(literalPercent, null, null, false), pathToFileURL(literalPercent).href);
  assert.equal(localFileUrl(encoded, null, path.dirname(document)), pathToFileURL(asset).href);
  assert.equal(localFileUrl('unresolved.png'), 'unresolved.png');
  for (const url of ['https://example.com/a.png', 'data:image/png;base64,AA==', pathToFileURL(asset).href]) assert.equal(localFileUrl(url, document), url);
  assert.equal(imageFileReference(asset, document, true, false), encoded);
  assert.equal(imageFileReference(asset, document, true, true), './' + encoded);
  assert.equal(imageFileReference(asset, document, false, true), pathToFileURL(asset).href);
  assert.equal(imageFileReference(asset, document, true, false, false), path.basename(asset));
  assert.deepEqual(launchFiles(['aropyt', '--hidden', path.relative(work, document), 'missing.md', '中文 folder'], work), [document]);
  assert.deepEqual(launchFiles(['aropyt', pathToFileURL(document).href, 'https://example.com/remote.md', 'file:///%invalid.md'], work), [document]);
  if (process.platform === 'win32') {
    assert.equal(imageFileReference('D:\\images\\图 #%.png', 'C:\\notes\\file.md', true, true), 'file:///D:/images/%E5%9B%BE%20%23%25.png');
    assert.equal(localFileUrl('images/a.png', 'C:\\root.md'), 'file:///C:/images/a.png');
    assert.equal(localFileUrl('\\\\server\\share\\中文 #%.png'), 'file://server/share/%E4%B8%AD%E6%96%87%20%23%25.png');
  }
  console.log(`PASS ${process.platform}/${process.arch}: local file URLs, Unicode/percent/hash/space escaping, image references, relative launch arguments${process.platform === 'win32' ? ', drive roots, cross-drive references and UNC shares' : ''}`);
} finally { await rm(work, { recursive: true, force: true }); }
