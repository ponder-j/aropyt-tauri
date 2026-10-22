import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
const root=process.cwd(),flags=new Set(process.argv.slice(2));
const run=(cmd,args,opts={})=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',...opts});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(cmd+' failed: '+c)));});
const env={...process.env,PATH:path.join(process.env.HOME,'.cargo/bin')+path.delimiter+process.env.PATH};
if(!flags.has('--no-build')&&!flags.has('--packaged')){await run(process.execPath,['build.mjs']);await run(path.join(process.env.HOME,'.cargo/bin/cargo'),['build','--manifest-path','src-tauri/Cargo.toml'],{env});}
const work=await mkdtemp(path.join(tmpdir(),'aropyt-tauri-test-'));
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const token=randomBytes(32).toString('hex');
const source=path.join(work,'中文 # 100% (fixture).md');
await writeFile(source,'# Initial document\n\nHello world.');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
for(const file of ['reference.png','reference space.png'])await writeFile(path.join(work,file),png);
await writeFile(path.join(work,'sized.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="blue"/></svg>');
await mkdir(path.join(work,'nested'));await writeFile(path.join(work,'nested/child.md'),'Nested document');
const executable=process.platform==='win32'?'aropyt.exe':'aropyt';
const binary=flags.has('--packaged')?(process.platform==='darwin'?'src-tauri/target/release/bundle/macos/Aropyt.app/Contents/MacOS/aropyt':'src-tauri/target/release/'+executable):(process.env.CARGO_TARGET_DIR||'src-tauri/target')+'/debug/'+executable;
const child=spawn(path.isAbsolute(binary)?binary:path.join(root,binary),[source],{env:{...env,AROPYT_DATA_DIR:path.join(work,'profile'),AROPYT_TEST_PORT:String(port),AROPYT_TEST_TOKEN:token},stdio:['ignore','pipe','pipe']});
let logs='';child.on('exit',(code,signal)=>{logs+='App exit: '+code+' '+signal+'\n';});child.stdout.on('data',s=>{logs+=s;});child.stderr.on('data',s=>{logs+=s;});
let windowLabel;
const call=async payload=>{const response=await fetch('http://127.0.0.1:'+port,{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({window:windowLabel,...payload})});const r=await response.json();if(!r.ok)throw Error(r.error);return r.value;};
const js=code=>call({op:'eval',code});const invoke=(method,...args)=>call({op:'invoke',method,args});
const wait=async(fn,ms=30000)=>{const start=Date.now();let last;while(Date.now()-start<ms){try{const value=await fn();if(value)return value;}catch(error){last=error;}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+last+'\n'+logs);};
await mkdir('release/verification',{recursive:true});
const passed=[];const pass=name=>{passed.push(name);console.log('PASS '+name);};
try{
 await wait(async()=>{const result=await js('({ready:Boolean(window.__aropyt),body:document.body.innerText})');if(!result.ready&&result.body.includes('documentChanged@'))throw Error(result.body);return result.ready;});
 windowLabel=(await call({op:'windows'})).find(label=>label.startsWith('editor-'));
 assert.equal(await js('window.__aropyt.state.file'),source);pass('Real Tauri WebView boots a Unicode/percent/hash/space path');
 await js(`window.__testErrors=[];addEventListener('error',e=>window.__testErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__testErrors.push(String(e.reason)));`);
 assert.equal((await invoke('setting.getAll')).spellCheck,false);assert((await invoke('dictionary.status')).every(s=>!s.installed));pass('Default install contains no dictionaries and spelling is disabled');
 const bytes=await readFile('resources/dictionaries.json','utf8');assert(bytes.includes('sha256'));
 // Catch accidental changes to retained renderer features with the original 67 checks.
 if(!flags.has('--spelling')&&!flags.has('--features')&&!flags.has('--export')){
   const output=await build({entryPoints:['tests/editor.ts'],bundle:true,write:false,platform:'browser',format:'iife'});const code=output.outputFiles[0].text;
   await js(`(async()=>{const frame=document.createElement('iframe');frame.id='regression-frame';frame.style.cssText='position:fixed;inset:0;width:1080px;height:900px;z-index:999999;background:white';document.body.append(frame);const d=frame.contentDocument;d.open();d.write('<html><head><link rel="stylesheet" href="'+new URL('/vendor/styles/base.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/vendor/styles/themes/github.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/vendor/styles/aropyt-file-icon/style.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/dist/renderer/styles/app.css',location.href).href+'"><style>body{display:block}#md-editor{height:100vh}</style></head><body><div id="md-editor"></div></body></html>');d.close();await Promise.all(Array.from(d.querySelectorAll('link'),link=>link.sheet?Promise.resolve():new Promise(resolve=>{link.onload=link.onerror=resolve})));frame.contentWindow.eval(${JSON.stringify(code)});})()`);
   const checks=await js(`document.getElementById('regression-frame').contentWindow.runEditorTests()`);for(const item of checks)pass(item);
   assert.deepEqual(await js(`document.getElementById('regression-frame').contentWindow.editorErrors()`),[]);await js(`document.getElementById('regression-frame').remove()`);
 }
 // Native filesystem/encoding/draft checks use the production dispatcher.
 const file=path.join(work,'saved.md');await invoke('fs.writeText',file,'中文\nHello\n','utf16le');assert.equal((await invoke('fs.readText',file,'utf16le')).content,'中文\nHello\n');
 await invoke('setting.put','trimTrailingWhitespace',true);await invoke('setting.put','insertFinalNewLineOnSave',true);await invoke('setting.put','lineEndings','crlf');await invoke('fs.writeText',file,'test  \n行','utf-8');assert.equal((await readFile(file)).toString(),'test\r\n行\r\n');
 await invoke('setting.put','trimTrailingWhitespace',false);await invoke('setting.put','insertFinalNewLineOnSave',false);await invoke('setting.put','lineEndings','lf');
 const id=await invoke('document.saveDraft',source,'RECOVERY','utf-8');assert.equal((await invoke('document.getDraft',id)).content,'RECOVERY');await invoke('document.removeDraft',id);pass('Native encodings, save preferences and atomic recovery drafts round-trip');
 assert((await js('window.JSBridge.invoke("menu.dump")')).lines.length>180);pass('Complete original native menu structure is installed');
 // Optional dictionaries download from pinned sources and load in the actual WebView WASM engine.
 if(!flags.has('--editor')){
  for(const lang of ['en-US','en-GB','fr']){const result=await invoke('dictionary.install',lang);assert.equal(result.installed,true);}
  assert.deepEqual(await js(`(async()=>{await window.JSBridge.invoke('spellcheck.configure','en-US');return window.JSBridge.invoke('spellcheck.check',['hello','helo','Aropyt','Typora','don’t'])})()`),['helo']);
  assert.equal((await js(`window.JSBridge.invoke('spellcheck.inspect','colour')`)).misspelled,true);
  assert((await js(`window.JSBridge.invoke('spellcheck.inspect','helo')`)).suggestions.includes('hello'));
  await js(`window.JSBridge.invoke('spellcheck.configure','en-GB')`);assert.equal((await js(`window.JSBridge.invoke('spellcheck.inspect','colour')`)).misspelled,false);
  await js(`window.JSBridge.invoke('spellcheck.learn','aropytcustomword')`);assert.equal((await js(`window.JSBridge.invoke('spellcheck.inspect','aropytcustomword')`)).misspelled,false);
  await js(`window.JSBridge.invoke('spellcheck.learn','aropytcustomword',true)`);assert.equal((await js(`window.JSBridge.invoke('spellcheck.inspect','aropytcustomword')`)).misspelled,true);
  assert.equal(await invoke('dictionary.detect','Le français est une langue que nous utilisons pour écrire des documents et vérifier les erreurs dans les phrases de ce texte.','en-US'),'fr');
  assert.deepEqual(await js(`window.JSBridge.invoke('spellcheck.check',Array(1001).fill('word'))`),[]);pass('Optional download, checksums, offline WASM spelling, UK/US differences, suggestions, learning and CLD2');
  await js(`window.JSBridge.invoke('spellcheck.configure','off')`);
 }
 // Preserve original feature suite, substituting only the native dialog picker responses.
 if(!flags.has('--editor')&&!flags.has('--spelling')){
  const output=await build({entryPoints:['tests/features.ts'],bundle:true,write:false,platform:'browser'});
  await js(`(()=>{window.__realInvoke=window.JSBridge.invoke;window.__testSaveMode='normal';window.JSBridge.invoke=async(method,...args)=>{if(method==='images.pickLocal')return [${JSON.stringify(path.join(work,'reference.png'))}];if(method==='pandoc.export')args[0].output=${JSON.stringify(path.join(work,'converted.'))}+({latex:'tex',mediawiki:'wiki',epub:'epub'}[args[0].format]||args[0].format);if(method==='dialog.showMessageBox')return {response:window.__testSaveMode==='save-cancel'?0:2};if(method==='export.saveFile'&&window.__testSaveMode==='save-cancel')return null;if(method==='dialog.showSaveDialog'&&window.__testSaveMode==='save-cancel')return{canceled:true};return window.__realInvoke(method,...args);};})()`);
  await js(`(0,eval)(${JSON.stringify(output.outputFiles[0].text)})`);const checks=await js('window.runFeatureChecks()');for(const item of checks)pass(item);
  const word=unzipSync(await readFile(path.join(work,'converted.docx')));const xml=strFromU8(word['word/document.xml']);assert(xml.includes('CONVERSION_TAIL')&&xml.includes('<w:tbl')&&xml.includes('<m:oMath'));assert(Object.keys(word).filter(p=>p.startsWith('word/media/')).length>=2);
  const sized=xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/g)?.find(s=>s.includes('HTML-sized'));assert(sized?.includes('cx="571500" cy="285750"'),'Sized HTML image lost 60x30 size: '+sized);
  assert((await invoke('pandoc.import',path.join(work,'converted.docx'))).content.includes('CONVERSION_TAIL'));assert((await stat(path.join(work,'converted.assets/diagram-1.png'))).size>0);pass('Real Word import/export: editable math, table, graph, HTML image sizing and persistent LaTeX assets');
  await js(`(async()=>{const api=window.__aropyt;api.getEditor().setValue('UNSAVED_MUST_SURVIVE');api.state.file=null;await api.runAction('new')})()`);assert.equal(await js('window.__aropyt.getEditor().value'),'UNSAVED_MUST_SURVIVE');await js(`window.__testSaveMode='save-cancel';window.__aropyt.runAction('new')`);assert.equal(await js('window.__aropyt.getEditor().value'),'UNSAVED_MUST_SURVIVE');await js(`window.JSBridge.invoke=window.__realInvoke`);pass('Cancel and cancelled Save As both preserve unsaved content');
  const content='# Tauri 导出\n\n中文与 English\n\n$x^2$\n\n```java\nint n = 1;\n```\n\n```mermaid\ngraph LR\n A[Start] --> B[End]\n```\n\n![reference](reference.png)\n\nEXPORT_TAIL';
  await js(`(()=>{const api=window.__aropyt;api.state.file=${JSON.stringify(source)};api.getEditor().setValue(${JSON.stringify(content)});})()`);
  const html=await js('window.__aropyt.prepareExport()');assert(html.includes('data:image/png;base64,')&&html.includes('EXPORT_TAIL')&&html.includes('<svg'));
  const pdf=Buffer.from(await invoke('export.htmlToPDF',html),'base64');const image=Buffer.from(await invoke('export.htmlToImage',html),'base64');assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.equal(image.subarray(1,4).toString(),'PNG');
  await mkdir('release/verification',{recursive:true});await writeFile('release/verification/export.pdf',pdf);await writeFile('release/verification/export.png',image);await writeFile('release/verification/export.html',html);pass('Native PDF/PNG exports use the complete static document with math, Mermaid, fonts and embedded images');
  const longHtml=html.replace('EXPORT_TAIL',Array.from({length:100},(_,i)=>'<p>Paragraph '+i+' LONG_DOCUMENT_CONTENT</p>').join('')+'<p>LONG_DOCUMENT_TAIL</p>');
  const longPdf=Buffer.from(await invoke('export.htmlToPDF',longHtml),'base64');await writeFile('release/verification/long-export.pdf',longPdf);assert(longPdf.length>pdf.length);pass('Native multipage PDF exports retain long document content');
  const tab=await invoke('document.newTab');assert.equal(tab,true);assert((await call({op:'windows'})).filter(s=>s.startsWith('editor-')).length>=2);pass('Multiple native document windows and macOS tab creation');
 }
 assert.deepEqual(await js('window.__testErrors'),[]);
 await writeFile('release/verification/test-results.json',JSON.stringify({date:new Date().toISOString(),platform:process.platform,arch:process.arch,passed},null,2));
 console.log(`\n${passed.length} Tauri checks passed. Profile isolated at ${work}`);
}catch(error){try{console.error('DOM DIAGNOSTIC',await js(`(()=>{const f=document.getElementById('regression-frame');if(!f)return document.body.innerText;const d=f.contentDocument,h=d.querySelector('.cm-header-2'),ref=d.createElement('h2');ref.textContent='Reference';d.querySelector('#md-editor').append(ref);return{image:d.querySelector('.cm-image-preview img')?.getBoundingClientRect().toJSON(),imageStyle:d.querySelector('.cm-image-preview img')?.getAttribute('style'),actual:h&&f.contentWindow.getComputedStyle(h).fontSize,expected:f.contentWindow.getComputedStyle(ref).fontSize,sheets:Array.from(d.styleSheets,s=>({href:s.href,rules:s.cssRules.length})),styles:Array.from(d.querySelectorAll('style'),s=>s.textContent.slice(0,500))}})()`));}catch{}console.error(logs);console.error('Evidence profile: '+work);throw error;}finally{child.kill('SIGTERM');}
