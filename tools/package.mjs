import { spawn } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
const args=['tools/tauri.mjs','build',...(process.platform==='darwin'?['--bundles','app']:['--no-bundle'])];
await new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('Package failed: '+code)));});
if(process.platform!=='darwin'){
 const executable='aropyt'+(process.platform==='win32'?'.exe':'');await mkdir('release/app',{recursive:true});
 await cp(path.join('src-tauri/target/release',executable),path.join('release/app',executable));
 for(const entry of ['resources/styles','resources/renderer-styles','docs','samples'])await cp(entry,path.join('release/app',entry),{recursive:true});
}
