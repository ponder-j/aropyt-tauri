// Maintainer tool. Downloads are optional user data; these packs never enter the application bundle.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { build } from 'esbuild';
const require=createRequire(import.meta.url);
const result=await build({entryPoints:['src/shared/spellcheck.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {SPELL_LANGUAGES}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
const manifest={version:1,languages:{}};
await mkdir('release/dictionaries',{recursive:true});
for(const [code,name,pkg] of SPELL_LANGUAGES){
 if(['zh','ja'].includes(code))continue;
 const custom=pkg.startsWith('vendor:');
 const dir=custom?'vendor/spellcheck/'+code:path.dirname(require.resolve('dictionary-'+pkg));
 const version=custom?'':JSON.parse(await readFile(path.join(dir,'package.json'),'utf8')).version;
 const base=custom?({id:'https://cdn.jsdelivr.net/gh/LibreOffice/dictionaries@40580c5dbb5b06fbf402b5864e736527b05cd2f5/id/id_ID',ar:'https://cdn.jsdelivr.net/gh/LibreOffice/dictionaries@951bb429a4d846699b02e7adb4fc6fca128c6bae/ar/ar',ms:'https://cdn.jsdelivr.net/gh/syafiqhadzir/hunspell-ms@acd53c61cadddd1b4a97f3cfb7c54669a47e6090/ms_MY'}[code]):`https://cdn.jsdelivr.net/npm/dictionary-${pkg}@${version}/index`;
 const files={};
 for(const ext of ['aff','dic']){const bytes=await readFile(path.join(dir,'index.'+ext));files[ext]={url:base+'.'+ext,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};await writeFile(`release/dictionaries/${code}.${ext}.gz`,gzipSync(bytes,{level:9}));}
 const license=await readFile(path.join(dir,custom?'LICENSE-dict':'license'),'utf8');
 manifest.languages[code]={name,files,license,encoding:code==='ms'?'ISO-8859-1':'UTF-8'};
}
await writeFile('resources/dictionaries.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Wrote pinned download manifest and optional dictionary packs.');
