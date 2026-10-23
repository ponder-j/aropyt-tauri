import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { unzipSync, strFromU8 } from 'fflate';
import { verifyNativeLanguage } from './test-localization.mjs';
const root=process.cwd(),flags=new Set(process.argv.slice(2));
const run=(cmd,args,opts={})=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{stdio:'inherit',...opts});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(cmd+' failed: '+c)));});
const cargoBin=path.join(process.env.CARGO_HOME||path.join(homedir(),'.cargo'),'bin');
const env={...process.env,PATH:cargoBin+path.delimiter+process.env.PATH};
if(!flags.has('--no-build')&&!flags.has('--packaged')&&!process.env.AROPYT_TEST_BINARY){await run(process.execPath,['build.mjs']);await run(path.join(cargoBin,process.platform==='win32'?'cargo.exe':'cargo'),['build','--manifest-path','src-tauri/Cargo.toml','--locked'],{env});}
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
const binary=process.env.AROPYT_TEST_BINARY||(flags.has('--packaged')?(process.platform==='darwin'?'src-tauri/target/release/bundle/macos/Aropyt.app/Contents/MacOS/aropyt':path.join(process.env.CARGO_TARGET_DIR||'src-tauri/target','release',executable)):path.join(process.env.CARGO_TARGET_DIR||'src-tauri/target','debug',executable));
const child=spawn(path.isAbsolute(binary)?binary:path.join(root,binary),[source],{env:{...env,AROPYT_DATA_DIR:path.join(work,'profile'),AROPYT_TEST_PORT:String(port),AROPYT_TEST_TOKEN:token},stdio:['ignore','pipe','pipe']});
let logs='';child.on('exit',(code,signal)=>{logs+='App exit: '+code+' '+signal+'\n';});child.stdout.on('data',s=>{logs+=s;});child.stderr.on('data',s=>{logs+=s;});
let windowLabel;
const call=async (payload,signal)=>{const response=await fetch('http://127.0.0.1:'+port,{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({window:windowLabel,...payload}),signal});const r=await response.json();if(!r.ok)throw Error(r.error);return r.value;};
const js=(code,target=windowLabel)=>call({op:'eval',code,window:target});const invoke=(method,...args)=>call({op:'invoke',method,args});
const wait=async(fn,ms=30000)=>{const start=Date.now();let last;while(Date.now()-start<ms){try{const value=await fn();if(value)return value;}catch(error){last=error;}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+last+'\n'+logs);};
await mkdir('release/verification',{recursive:true});
const passed=[];const pass=name=>{passed.push(name);console.log('PASS '+name);};
try{
 await wait(async()=>{if(child.exitCode!==null||child.signalCode)throw Error('Application exited before WebView startup: '+logs);const result=await js('({ready:Boolean(window.__aropyt),body:document.body.innerText})');if(!result.ready&&result.body.includes('documentChanged@'))throw Error(result.body);return result.ready;},90000);
 windowLabel=(await call({op:'windows'})).find(label=>label.startsWith('editor-'));
 await invoke('window.focus');
 assert.equal(await js('window.__aropyt.state.file'),source);pass('Real Tauri WebView boots a Unicode/percent/hash/space path');
 await js(`window.__testErrors=[];addEventListener('error',e=>window.__testErrors.push(e.message));addEventListener('unhandledrejection',e=>window.__testErrors.push(String(e.reason)));`);
 assert.equal((await invoke('setting.getAll')).spellCheck,false);assert((await invoke('dictionary.status')).every(s=>!s.installed));pass('Default install contains no dictionaries and spelling is disabled');
 const bytes=await readFile('resources/dictionaries.json','utf8');assert(bytes.includes('sha256'));
 // Catch accidental changes to retained renderer features with the original 67 checks.
 if(!flags.has('--spelling')&&!flags.has('--features')&&!flags.has('--export')){
   const output=await build({entryPoints:['tests/editor.ts'],bundle:true,write:false,platform:'browser',format:'iife'});const code=output.outputFiles[0].text;
   await js(`(async()=>{const frame=document.createElement('iframe');frame.id='regression-frame';frame.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;z-index:1;background:white';document.getElementById('main-content').append(frame);const d=frame.contentDocument;d.open();d.write('<html><head><link rel="stylesheet" href="'+new URL('/vendor/styles/base.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/vendor/styles/themes/github.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/vendor/styles/aropyt-file-icon/style.css',location.href).href+'"><link rel="stylesheet" href="'+new URL('/dist/renderer/styles/app.css',location.href).href+'"><style>body{display:block}#md-editor{height:100vh}</style></head><body><div id="md-editor"></div></body></html>');d.close();await Promise.all(Array.from(d.querySelectorAll('link'),link=>link.sheet?Promise.resolve():new Promise(resolve=>{link.onload=link.onerror=resolve})));frame.contentWindow.eval(${JSON.stringify(code)});})()`);
   assert.equal(await js(`(()=>{const f=document.getElementById('regression-frame'),bar=document.getElementById('ty-footer'),r=bar.getBoundingClientRect();return f.getBoundingClientRect().bottom<=r.top+1&&bar.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))})()`),true,'The editor regression fixture covered the status bar');
   pass('Editor regression fixture stays inside the editor viewport and leaves the status bar accessible');
   await js(`(()=>{const w=document.getElementById('regression-frame').contentWindow;w.runEditorTests().then(checks=>w.__editorChecks={checks},error=>w.__editorChecks={error:String(error)+'\\n'+String(error.stack||'')});return true})()`);
   const result=await wait(()=>js(`document.getElementById('regression-frame').contentWindow.__editorChecks||null`),600000);
   if(result.error)throw Error(result.error);for(const item of result.checks)pass(item);
   assert.deepEqual(await js(`document.getElementById('regression-frame').contentWindow.editorErrors()`),[]);
   // Hand focus back before removing the active frame; WebKit otherwise keeps
   // activeElement without restoring the parent document's CSS focus state.
   await js(`(()=>{window.__aropyt.getEditor().focus();document.getElementById('regression-frame').remove()})()`);
   await invoke('window.focus');
   await wait(()=>js(`document.hasFocus() && document.activeElement === window.__aropyt.getEditor().view.contentDOM && document.activeElement.matches(':focus')`));
 }
 if(!flags.has('--spelling')&&!flags.has('--editor')){
  const layout=await build({entryPoints:['tests/layout.ts'],bundle:true,write:false,platform:'browser'});
  await js(`(0,eval)(${JSON.stringify(layout.outputFiles[0].text)})`);
  for(const check of await js('window.runLayoutChecks()'))pass(check);
 }
 // Native filesystem/encoding/draft checks use the production dispatcher.
 const file=path.join(work,'saved.md');await invoke('fs.writeText',file,'中文\nHello\n','utf16le');assert.equal((await invoke('fs.readText',file,'utf16le')).content,'中文\nHello\n');
 await invoke('setting.put','trimTrailingWhitespace',true);await invoke('setting.put','insertFinalNewLineOnSave',true);await invoke('setting.put','lineEndings','crlf');await invoke('fs.writeText',file,'test  \n行','utf-8');assert.equal((await readFile(file)).toString(),'test\r\n行\r\n');
 await invoke('setting.put','trimTrailingWhitespace',false);await invoke('setting.put','insertFinalNewLineOnSave',false);await invoke('setting.put','lineEndings','lf');
 const id=await invoke('document.saveDraft',source,'RECOVERY','utf-8');assert.equal((await invoke('document.getDraft',id)).content,'RECOVERY');await invoke('document.removeDraft',id);pass('Native encodings, save preferences and atomic recovery drafts round-trip');
 assert((await js('window.JSBridge.invoke("menu.dump")')).lines.length>180);pass('Complete original native menu structure is installed');
 if(['darwin','linux'].includes(process.platform)){
  const flatten=items=>items.flatMap(item=>[item,...flatten(item.submenu||[])]);
  const closed=flatten(await call({op:'native-menu'})),shown=flatten(await call({op:'native-menu',preview:true}));
  assert(closed.every(item=>!/[\t]| {3,}/.test(item.label)),'Shortcut hints were appended to native item titles');
  const focus=shown.find(item=>['专注模式','Focus Mode'].includes(item.label)),typewriter=shown.find(item=>['打字机模式','Typewriter Mode'].includes(item.label));
  assert(focus&&typewriter,'Native menu lost focus/typewriter entries');
  for(const labels of [['删除行','Delete Row'],['清除样式','Clear Format'],['代码','Code'],['源代码模式','Source Code Mode']]){
   const entry=shown.find(item=>labels.includes(item.label));assert(entry,'Missing native menu entry '+labels[0]);
   assert(process.platform==='darwin'?entry.key.length>0:entry.keyValue>0,'Native shortcut column lost Backspace or a punctuation key: '+labels[0]);
  }
  if(process.platform==='darwin'){
   assert.equal(focus.key,String.fromCharCode(0xf70b));assert.equal(typewriter.key,String.fromCharCode(0xf70c));
   const redo=shown.find(item=>['重做','Redo'].includes(item.label));
   assert.equal(redo?.key,'z');assert(redo.modifiers & (1<<17),'macOS Redo did not use Command-Shift-Z');
   assert(shown.filter(item=>item.displayOnly).length>20,'Display-only shortcut hints were not installed throughout the menu');
   assert(shown.filter(item=>item.displayOnly).every(item=>item.key.length>0),'An opened menu lost a native shortcut hint: '+JSON.stringify(shown.filter(item=>item.displayOnly&&!item.key.length)));
   const after=flatten(await call({op:'native-menu'}));
   assert(after.filter(item=>item.displayOnly).every(item=>item.key===''),'Closed menus captured renderer-owned editing keys');
   assert(after.find(item=>['显示/隐藏侧边栏','Toggle Sidebar'].includes(item.label))?.key,'Registered navigation shortcut was removed');
  }else{
   assert.equal(focus.keyValue,0xffc5);assert.equal(typewriter.keyValue,0xffc6);
   assert(shown.filter(item=>item.displayOnly).length>20,'GTK shortcut labels registered editing keys or lost their display column');
  }
  pass('Native menu shortcut hints use a separate system column without registering renderer-owned editing keys');
 }
 // Optional dictionaries download from pinned sources and load in the actual WebView WASM engine.
 // --offline keeps editor/UI verification independent of the live CDN.
 if(!flags.has('--editor')&&!flags.has('--offline')){
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
 if(!flags.has('--editor')&&!flags.has('--spelling')){
  await invoke('window.focus');
  await verifyNativeLanguage({invoke,js,snapshot:process.platform==='win32'?undefined:()=>call({op:'native-menu'})});
  pass('Native menus, app dialogs and error messages follow the selected language while preserving paths and commands');
  const output=await build({entryPoints:['tests/localization.ts'],bundle:true,write:false,platform:'browser'});
  await js(`(0,eval)(${JSON.stringify(output.outputFiles[0].text)})`);
  for(const check of await js('window.runLocalizationChecks()'))pass(check);
  const otherWindow=(await call({op:'windows'})).find(label=>label.startsWith('editor-')&&label!==windowLabel);
  await wait(()=>js('Boolean(window.__aropyt)',otherWindow));
  const originalLanguage=(await invoke('setting.getAll')).menuLanguage;
  const mainBeforeMenu=await js(`({text:window.__aropyt.getEditor().value,source:window.__aropyt.state.sourceMode})`);
  await js(`window.JSBridge.invoke('setting.put','menuLanguage','en')`);
  await js(`window.JSBridge.invoke('setting.clearRecentDocuments')`,otherWindow);
  const menuFile=path.join(work,'menu recent 中文.md');await writeFile(menuFile,'RECENT_MENU_TARGET');
  for(const recent of [source,menuFile])await js(`window.JSBridge.invoke('setting.updateRecentFile',${JSON.stringify(recent)})`);
  // Only the main window rebuilt its menu after the recent list grew. The old
  // per-window callback indexes therefore point at different commands here.
  const otherSource=await js('window.__aropyt.state.sourceMode',otherWindow);
  await call({op:'menu-event',window:otherWindow,label:'Source Code Mode'});
  await wait(()=>js(`window.__aropyt.state.sourceMode===${!otherSource}`,otherWindow));
  await call({op:'menu-event',window:otherWindow,label:'Source Code Mode'});
  await wait(()=>js(`window.__aropyt.state.sourceMode===${otherSource}`,otherWindow));
  await call({op:'menu-event',window:otherWindow,label:path.basename(menuFile)});
  await wait(()=>js(`window.__aropyt.state.file===${JSON.stringify(menuFile)}`,otherWindow));
  assert.equal(await js('window.__aropyt.getEditor().value',otherWindow),'RECENT_MENU_TARGET');
  assert.deepEqual(await js(`({text:window.__aropyt.getEditor().value,source:window.__aropyt.state.sourceMode})`),mainBeforeMenu);
  await js(`window.JSBridge.invoke('setting.put','menuLanguage',${JSON.stringify(originalLanguage||'auto')})`);
  pass('Native menu commands and recent-file paths stay correct across windows after dynamic menu entries change');
  const startup=await build({entryPoints:['tests/startup-events.ts'],bundle:true,write:false,platform:'browser'});
  await js(`(0,eval)(${JSON.stringify(startup.outputFiles[0].text)})`);
  for(const check of await js('window.runStartupEventChecks()'))pass(check);
  await invoke('window.focus');
  const backgroundSelection=await js(`(()=>{const e=window.__aropyt.getEditor();e.view.dispatch({selection:{anchor:2,head:9}});e.focus();return e.view.state.selection.main.toJSON()})()`);
  await invoke('window.openPreferences');
  await wait(()=>js(`!!document.querySelector('[data-key]')`,'preferences'));
  const prefs=await build({entryPoints:['tests/localization-preferences.ts'],bundle:true,write:false,platform:'browser'});
  await js(`(0,eval)(${JSON.stringify(prefs.outputFiles[0].text)})`,'preferences');
  for(const check of await js('window.runPreferencesLocalizationChecks()','preferences'))pass(check);
  const prefsLanguage=(await invoke('setting.getAll')).menuLanguage;
  await js(`window.JSBridge.invoke('setting.put','menuLanguage','en')`,'preferences');
  await js(`window.__languageEvents=[];window.JSBridge.on(event=>{if(event.type==='setting-changed'&&event.arg?.key==='menuLanguage')window.__languageEvents.push(event.arg.value)});`,'preferences');
  // Model an older cross-window notification arriving after a newer write.
  await call({op:'send-event',window:'preferences',event:{type:'setting-changed',arg:{key:'menuLanguage',value:'zh'}}});
  await wait(()=>js(`window.__languageEvents.includes('zh')`,'preferences'));
  await js(`window.JSBridge.invoke('menu.dump')`,'preferences');
  assert.equal(await js('document.documentElement.lang','preferences'),'en','An old language event overwrote the latest persisted preference');
  assert.equal((await invoke('setting.getAll')).menuLanguage,'en');
  await js(`window.JSBridge.invoke('setting.put','menuLanguage',${JSON.stringify(prefsLanguage||'auto')})`,'preferences');
  pass('A delayed language notification cannot overwrite the latest persisted language in Preferences');
  const documentBeforeClose=await js('window.__aropyt.getEditor().value');
  for(const target of [windowLabel,'preferences'])await js(`window.__windowEvents=[];window.JSBridge.on(event=>window.__windowEvents.push(event.type));`,target);
  await call({op:'send-event',window:'preferences',event:{type:'test-window-target'}});
  await invoke('prefs.applyChrome');
  await wait(async()=>await js(`window.__windowEvents.includes('reapply-chrome')`)&&await js(`window.__windowEvents.includes('reapply-chrome')`,'preferences'));
  assert.equal(await js(`window.__windowEvents.filter(type=>type==='test-window-target').length`),0,'A preferences event leaked into the editor');
  assert.equal(await js(`window.__windowEvents.filter(type=>type==='test-window-target').length`,'preferences'),1);
  await call({op:'send-event',window:'preferences',event:{type:'menu',arg:{action:'close'}}});
  await wait(async()=>!(await call({op:'windows'})).includes('preferences'));
  assert((await call({op:'windows'})).includes(windowLabel));
  assert.equal(await js('window.__aropyt.getEditor().value'),documentBeforeClose);
  assert.equal(await js(`window.__windowEvents.filter(type=>['menu','request-close'].includes(type)).length`),0,'Closing Preferences also requested an editor close');
  pass('Native window events stay in their target window; closing Preferences preserves the editor and global preference broadcasts still arrive');
  await invoke('window.focus');
  await wait(()=>js('window.__aropyt.getEditor().view.hasFocus'));
  assert.deepEqual(await js('window.__aropyt.getEditor().view.state.selection.main.toJSON()'),backgroundSelection);
  assert.equal(await js('window.getSelection().isCollapsed'),false);
  pass('Background editor selection preserves foreground preference input selection and returns with native focus and the original range');
 }
 assert.deepEqual(await js('window.__testErrors'),[]);
 await writeFile('release/verification/test-results.json',JSON.stringify({date:new Date().toISOString(),platform:process.platform,arch:process.arch,passed},null,2));
 console.log(`\n${passed.length} Tauri checks passed. Profile isolated at ${work}`);
}catch(error){await writeFile('release/verification/app.log',logs);try{console.error('DOM DIAGNOSTIC',await js(`(()=>{const f=document.getElementById('regression-frame');if(!f)return document.body.innerText;const d=f.contentDocument,h=d.querySelector('.cm-header-2'),ref=d.createElement('h2');ref.textContent='Reference';d.querySelector('#md-editor').append(ref);return{image:d.querySelector('.cm-image-preview img')?.getBoundingClientRect().toJSON(),imageStyle:d.querySelector('.cm-image-preview img')?.getAttribute('style'),actual:h&&f.contentWindow.getComputedStyle(h).fontSize,expected:f.contentWindow.getComputedStyle(ref).fontSize,sheets:Array.from(d.styleSheets,s=>({href:s.href,rules:s.cssRules.length})),styles:Array.from(d.querySelectorAll('style'),s=>s.textContent.slice(0,500))}})()`));}catch{}console.error(logs);console.error('Evidence profile: '+work);throw error;}finally{try{await call({op:'quit'},AbortSignal.timeout(3000));}catch{}child.kill('SIGTERM');}
