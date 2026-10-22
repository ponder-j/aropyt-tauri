import './polyfills';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildMenu, menuLanguage } from './menu';
import { MenuItemConstructorOptions, setMenuSettings, platform } from './menu-host';
import { localFileUrl, filePath } from './files';
import { Spelling, installUnderlines } from './spelling';
const callbacks=new Set<(event:any)=>void>();
const pending:any[]=[];
function publish(event:any):void{if(!callbacks.size){pending.push(event);return;}for(const cb of callbacks)cb(event);}
const raw=async(method:string,...args:any[]):Promise<any>=>{
  try{return await nativeInvoke('bridge',{method,args});}catch(error){throw new Error(String(error));}
};
const spelling=new Spelling(raw,publish);
let menuCallbacks=new Map<string,()=>void>();
let menuLines:string[]=[];
let settings:Record<string,any>={};
let refreshing:Promise<void>|undefined;
async function refreshMenu():Promise<void>{
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    settings=await raw('setting.getAll');setMenuSettings(settings);
    const themes=await raw('setting.getThemes');
    const template=buildMenu({send:(type,arg)=>publish({type,arg}),listThemes:()=>themes,currentTheme:()=>settings.theme,openFile:file=>publish({type:'open-file',arg:file})});
    const next=new Map<string,()=>void>();menuLines=[];let counter=0;
    const serialize=(entries:MenuItemConstructorOptions[],depth=0):any[]=>entries.map(entry=>{
      const id='menu-'+counter++;if(entry.click)next.set(id,entry.click);
      const {click,...value}=entry;menuLines.push('  '.repeat(depth)+(entry.type==='separator'?'----':entry.label||entry.role||'')+(entry.accelerator?'  ['+entry.accelerator+']':''));
      return {...value,id,submenu:entry.submenu?serialize(entry.submenu,depth+1):undefined};
    });
    const value=serialize(template);menuCallbacks=next;await raw('menu.install',value);
  })().finally(()=>{refreshing=undefined;});return refreshing;
}
async function invoke(method:string,...args:any[]):Promise<any>{
  await ready;
  if(method==='menu.dump'){await refreshMenu();return{lang:menuLanguage(),locale:navigator.language,pref:settings.menuLanguage,lines:menuLines};}
  if(['menu.refreshThemeMenu','recent.refreshMenu'].includes(method)){await refreshMenu();return true;}
  if(method.startsWith('spellcheck.')||['window.spellCheck','setting.getUserDict','setting.addUserDict','setting.removeUserDict'].includes(method))return spelling.handle(method,args);
  if(method==='webContents.pastePlain'){const value=await raw('clipboard.read');document.execCommand('insertText',false,value);return true;}
  if(method==='webContents.paste'){const {text,html}=await raw('clipboard.readRich');document.execCommand(html?'insertHTML':'insertText',false,html||text);return true;}
  if(method==='executeJavaScript')return (0,eval)(args[0]);
  if(method==='webContents.clearCache'){localStorage.clear();return true;}
  if(/^webContents\.(undo|redo|cut|copy|selectAll)$/.test(method)){document.execCommand(method.split('.')[1]);return true;}
  const result=await raw(method,...args);
  if(['setting.put','setting.setCurTheme','setting.clearRecentDocuments','setting.updateRecentFile','setting.addRecentFolder','setting.removeRecentFolder','setting.removeRecentDocument'].includes(method))await refreshMenu();
  return result;
}
(window as any).JSBridge={invoke,send:(channel:string,payload?:unknown)=>{void raw('bridge.send',channel,payload).catch(console.error);},on:(cb:(e:any)=>void)=>{callbacks.add(cb);while(pending.length)cb(pending.shift());},pathForFile:(file:File)=>(file as any).__aropytPath||'',localFileUrl};
const ready=(async()=>{
  await listen<any>('aropyt:event',({payload})=>{
    if(payload.type==='native-menu'){
      if(payload.arg.role){void role(payload.arg.role);return;}
      menuCallbacks.get(payload.arg.id)?.();return;
    }
    if(payload.type==='dictionary-installed'){spelling.invalidate(payload.arg);void spelling.handle('spellcheck.reset',[]);}
    if(payload.type==='dictionary-users')void spelling.reloadUsers();
    if(payload.type==='setting-changed'){
      void refreshMenu();if(['presetSpellCheck','spellCheck'].includes(payload.arg.key))void spelling.handle('spellcheck.reset',[]);
    }
    publish(payload);
  });
  await spelling.initialize();
})();
async function role(name:string):Promise<void>{
  if(['cut','copy','paste','selectAll'].includes(name)){await invoke('webContents.'+name);return;}
  if(name==='pasteAndMatchStyle'){await invoke('webContents.pastePlain');return;}
  if(name==='quit'){await raw('app.quit');return;}
  if(name==='about'){await raw('window.about');return;}
  if(name==='minimize'){await raw('window.minimize');return;}
  if(name==='zoom'){await raw('window.toggleMaximize');return;}
  await raw('window.nativeAction',name);
}
// Tauri supplies OS paths on drop; DOM File intentionally has no native path.
void getCurrentWebviewWindow().onDragDropEvent(event=>{
  if(event.payload.type!=='drop')return;
  document.querySelector('#md-editor .cm-editor')?.dispatchEvent(new CustomEvent('aropyt-drop',{detail:event.payload.paths,bubbles:true,cancelable:true}));
});
window.addEventListener('DOMContentLoaded',()=>{
  const attach=()=>{if(document.querySelector('#md-editor .cm-editor')){installUnderlines(spelling);}else if(location.pathname.endsWith('index.html'))setTimeout(attach,100);};attach();
  document.addEventListener('click',event=>{const link=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');if(link&&/^https?:/i.test(link.href)){event.preventDefault();void raw('shell.openExternal',link.href);}},true);
});
(window as any).__aropytPlatform={platform,filePath,spelling,refreshMenu};
