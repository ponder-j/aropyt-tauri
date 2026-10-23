import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function updaterManifest(directory, version, repository = 'ponder-j/aropyt-tauri', notes = '') {
  const name = `Aropyt_${version}_x64-setup.exe`;
  const signature = (await readFile(path.join(directory, name + '.sig'), 'utf8')).trim();
  if (!signature || !Buffer.from(signature, 'base64').toString('utf8').startsWith('untrusted comment:')) throw Error('Invalid Windows updater signature');
  return { version, notes, pub_date: new Date().toISOString(), platforms: {
    'windows-x86_64': { signature, url: `https://github.com/${repository}/releases/download/v${version}/${name}` },
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory = 'release/artifacts', version = JSON.parse(await readFile('package.json', 'utf8')).version] = process.argv.slice(2);
  const manifest = await updaterManifest(directory, version);
  await writeFile(path.join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
