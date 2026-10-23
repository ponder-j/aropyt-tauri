import './polyfills';
import { setUiLanguage } from '../shared/ui-language';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { buildMenu, menuLanguage } from './menu';
import { MenuItemConstructorOptions, serializeMenu, setMenuSettings, platform } from './menu-host';
import { localFileUrl, filePath } from './files';
import { Spelling, installUnderlines } from './spelling';
import { WindowsMenu } from './windows-menu';
import { messageDialog, type MessageBoxOptions } from '../renderer/dialogs';
const callbacks=new Set<(event:any)=>void>();
const pending:any[]=[];
function publish(event:any):void{if(!callbacks.size){pending.push(event);return;}for(const cb of callbacks)cb(event);}
const raw=async(method:string,...args:any[]):Promise<any>=>{
  if(method==='dialog.showMessageBox')return messageDialog(args[0] ?? {});
  try{
    const result=await nativeInvoke<any>('bridge',{method,args});
    if(result?.__aropytMessageBox)return messageDialog(result.__aropytMessageBox as MessageBoxOptions);
    return result;
  }catch(error){throw new Error(String(error));}
};
const spelling=new Spelling(raw,publish);
let menuLines:string[]=[];
const menuInstance=`${getCurrentWebviewWindow().label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let menuGeneration=0;
let settings:Record<string,any>={};
let refreshing:Promise<void>|undefined;
let refreshAgain=false;
let windowsMenu: WindowsMenu | undefined;
function dispatchMenu(entry: MenuItemConstructorOptions): void {
  if(entry.role){void role(entry.role);return;}
  if(entry.event==='bridge'&&entry.action==='clearRecent'){void invoke('setting.clearRecentDocuments');return;}
  if(entry.event==='open-file')publish({type:'open-file',arg:entry.arg});
  else if(entry.event==='menu')publish({type:'menu',arg:{action:entry.action,arg:entry.arg}});
}
async function refreshMenu():Promise<void>{
  if(refreshing){refreshAgain=true;return refreshing;}
  refreshing=(async()=>{
    do {
      refreshAgain=false;
      settings=await raw('setting.getAll');setMenuSettings(settings);setUiLanguage(menuLanguage());
      const themes=await raw('setting.getThemes');
      const template=buildMenu({listThemes:()=>themes,currentTheme:()=>settings.theme});
      menuLines=[];
      const describe=(entries:MenuItemConstructorOptions[],depth=0):void=>{for(const entry of entries){
        menuLines.push('  '.repeat(depth)+(entry.type==='separator'?'----':entry.label||entry.role||'')+(entry.accelerator?'  ['+entry.accelerator+']':''));
        if(entry.submenu)describe(entry.submenu,depth+1);
      }};
      describe(template);
      // Unique generations also prevent a queued event from an old native menu
      // from accidentally selecting a different item after replacement.
      await raw('menu.install',serializeMenu(template,`${menuInstance}-${++menuGeneration}`));
      if(platform==='win32'&&location.pathname.endsWith('index.html')) {
        windowsMenu ||= new WindowsMenu(dispatchMenu); windowsMenu.update(template);
      }
    } while(refreshAgain);
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
  await getCurrentWebviewWindow().listen<any>('aropyt:event',({payload})=>{
    if(payload.type==='native-menu'){
      if(payload.arg.role){void role(payload.arg.role);return;}
      const {event,action,arg}=payload.arg;
      if(event==='bridge'&&action==='clearRecent'){void invoke('setting.clearRecentDocuments');return;}
      if(event==='menu')publish({type:'menu',arg:{action,arg}});
      else if(event==='open-file')publish({type:'open-file',arg});
      return;
    }
    if(payload.type==='dictionary-installed'){spelling.invalidate(payload.arg);void spelling.handle('spellcheck.reset',[]);}
    if(payload.type==='dictionary-users')void spelling.reloadUsers();
    if(payload.type==='setting-changed'){
      if(payload.arg.key==='menuLanguage'){settings.menuLanguage=payload.arg.value;setMenuSettings(settings);setUiLanguage(menuLanguage());}
      void refreshMenu();if(['presetSpellCheck','spellCheck'].includes(payload.arg.key))void spelling.handle('spellcheck.reset',[]);
    }
    publish(payload);
  });
  settings=await raw('setting.getAll');setMenuSettings(settings);setUiLanguage(menuLanguage());
  await raw('app.setUiLocale',navigator.language);
  await spelling.initialize();
  await refreshMenu();
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
