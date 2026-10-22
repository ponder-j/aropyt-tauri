import { uiText as tr } from '../shared/ui-language';
import { loadModule, Hunspell, HunspellFactory } from 'hunspell-asm';
import { checkSpellBatch, dictionaryLanguage, normalizeSpellWord, spellMode, SpellState } from '../shared/spellcheck';
type Invoke = (method: string, ...args: any[]) => Promise<any>;
export class Spelling {
  state: SpellState = { mode: 'off', language: dictionaryLanguage(navigator.language), enabled: false, revision: 0 };
  private factory?: Promise<HunspellFactory>;
  private checkers = new Map<string, {checker: Hunspell; paths: string[]}>();
  private users: Record<string,string[]> = {};
  private sample = '';
  constructor(private invoke: Invoke, private publish: (event: any) => void) {}
  private announce(): SpellState { this.publish({type:'spellcheck-state',arg:{...this.state}}); return {...this.state}; }
  async initialize(): Promise<void> {
    const settings = await this.invoke('setting.getAll'); this.users = await this.invoke('dictionary.users');
    const mode = settings.spellCheck === false ? 'off' : spellMode(settings.presetSpellCheck);
    await this.configure(mode, false);
  }
  async configure(mode: unknown, prompt = true): Promise<SpellState> {
    const chosen=spellMode(mode), language=dictionaryLanguage(chosen === 'auto'||chosen === 'off' ? navigator.language : chosen);
    if(chosen !== 'off' && !await this.invoke('dictionary.exists',language)) {
      if(!prompt)return this.announce();
      const answer=await this.invoke('dialog.showMessageBox',{message:tr('下载离线拼写词典？','Download an offline spelling dictionary?'),detail:tr('只下载 '+language+' 词典。词典用于拼写检查，文稿内容不会上传。也可在偏好设置中导入本地词典。','Only the '+language+' dictionary will be downloaded. It is used for spelling checks; document content is never uploaded. You can also import a local dictionary in Preferences.'),buttons:[tr('下载词典','Download Dictionary'),tr('取消','Cancel')],cancelId:1});
      if(answer.response!==0)return this.announce();
      const installed=await this.invoke('dictionary.install',language);if(installed?.error)throw Error(installed.error);
    }
    this.state={mode:chosen,language,enabled:chosen!=='off',revision:this.state.revision};return this.announce();
  }
  async checker(language: string): Promise<Hunspell> {
    const lang=dictionaryLanguage(language), existing=this.checkers.get(lang);
    if(existing){this.checkers.delete(lang);this.checkers.set(lang,existing);return existing.checker;}
    if(!await this.invoke('dictionary.exists',lang)) throw Error(tr('尚未安装 '+lang+' 拼写词典，请从偏好设置下载或导入。','The '+lang+' spelling dictionary is not installed. Download or import it in Preferences.'));
    const factory=await(this.factory ||= loadModule());if(this.checkers.has(lang))return this.checkers.get(lang)!.checker;
    const bytes: string[]=await this.invoke('dictionary.read',lang);
    const paths=bytes.map(b64=>factory.mountBuffer(Uint8Array.from(atob(b64),c=>c.charCodeAt(0))));
    const checker=factory.create(paths[0],paths[1]);checker.addWord('Aropyt');checker.addWord('Typora');this.checkers.set(lang,{checker,paths});
    if(this.checkers.size>3){const [oldLang,old]=this.checkers.entries().next().value!;old.checker.dispose();old.paths.forEach(p=>factory.unmount(p));this.checkers.delete(oldLang);}
    return checker;
  }
  async check(words:string[]):Promise<string[]> {
    if(!this.state.enabled||words.length>1000||!words.length)return [];
    const lang=this.state.language, checker=await this.checker(lang);
    return checkSpellBatch(words,{isMisspelled:word=>!this.learned(lang,word)&&!checker.spell(word)});
  }
  learned(lang:string,word:string):boolean {return(this.users[dictionaryLanguage(lang)]||[]).includes(normalizeSpellWord(word));}
  async inspect(word:string):Promise<any>{
    const lang=this.state.language,normalized=normalizeSpellWord(word.trim()),learned=this.learned(lang,normalized);
    if(!normalized||normalized===';'||/\p{Script=Han}/u.test(normalized)||!this.state.enabled)return{misspelled:false,learned,suggestions:[]};
    const checker=await this.checker(lang),misspelled=!learned&&!checker.spell(normalized);
    return{misspelled,learned,suggestions:misspelled?checker.suggest(normalized).slice(0,6):[]};
  }
  async handle(method:string,args:any[]):Promise<any>{
    switch(method){
      case 'spellcheck.state':return this.announce();
      case 'spellcheck.configure':return this.configure(args[0]);
      case 'window.spellCheck':return this.configure(args[0]?'auto':'off');
      case 'spellcheck.reset':{const s=await this.invoke('setting.getAll');return this.configure(s.spellCheck===false?'off':s.presetSpellCheck,false);}
      case 'spellcheck.sample':{
        const sample=String(args[0]).slice(0,4000);if(this.state.mode!=='auto'||this.sample===sample)return this.announce();this.sample=sample;
        const detected=dictionaryLanguage(await this.invoke('dictionary.detect',sample,navigator.language));
        if(this.state.mode==='auto'&&this.sample===sample&&await this.invoke('dictionary.exists',detected)){this.state.language=detected;return this.announce();}return this.state;
      }
      case 'spellcheck.check':return this.check(args[0]);
      case 'spellcheck.inspect':return this.inspect(args[0]);
      case 'spellcheck.learn':{
        this.users=await this.invoke('dictionary.learn',this.state.language,normalizeSpellWord(args[0]),!!args[1]);this.state.revision=(this.state.revision||0)+1;this.announce();return true;
      }
      case 'setting.getUserDict':return Array.from(new Set(Object.values(this.users).flat())).sort();
      case 'setting.addUserDict':return this.handle('spellcheck.learn',args);
      case 'setting.removeUserDict':return this.handle('spellcheck.learn',[args[0],true]);
      default:throw Error(tr('未知拼写操作：','Unknown spelling method: ')+method);
    }
  }
  invalidate(language:string):void{const old=this.checkers.get(language);if(old){old.checker.dispose();void this.factory?.then(factory=>old.paths.forEach(p=>factory.unmount(p)));this.checkers.delete(language);}}
  async reloadUsers():Promise<void>{this.users=await this.invoke('dictionary.users');this.state.revision=(this.state.revision||0)+1;this.announce();}
}

// System WebViews do not expose Electron's spellcheck provider. Highlight the
// actual DOM text so table-cell editing and hidden Markdown retain their caret.
export function installUnderlines(spelling:Spelling):void {
  const host=document.querySelector('#md-editor');if(!host)return;
  const highlights=(CSS as any).highlights, HighlightClass=(window as any).Highlight;
  const nativeHighlights=!!highlights&&!!HighlightClass;
  let overlay:HTMLElement|undefined;
  if(!nativeHighlights){overlay=document.createElement('div');overlay.className='aropyt-spelling-overlay';overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden';document.body.append(overlay);}
  const style=document.createElement('style');style.textContent='::highlight(aropyt-spelling){text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#d83838}';document.head.append(style);
  let timer:number|undefined, generation=0;
  const run=async()=>{
    const current=++generation;highlights?.delete('aropyt-spelling');overlay?.replaceChildren();if(!spelling.state.enabled)return;
    const words:{word:string;range:Range}[]=[];const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode as Text, parent=node.parentElement;
      if(!parent||parent.closest('[spellcheck="false"],.cm-code-language,.cm-image-fallback,button,[aria-hidden="true"]')||!parent.getClientRects().length)continue;
      const re=/[\p{L}][\p{L}\p{M}'’.-]*/gu;let match:RegExpExecArray|null;
      while((match=re.exec(node.data))&&words.length<2000){if(/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(match[0]))continue;const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);words.push({word:match[0],range});}
    }
    const ranges:Range[]=[];
    for(let n=0;n<words.length;n+=200){const batch=words.slice(n,n+200);const bad=new Set(await spelling.check(batch.map(w=>w.word)));if(current!==generation)return;for(const w of batch)if(bad.has(w.word))ranges.push(w.range);}
    if(current===generation){if(nativeHighlights)highlights.set('aropyt-spelling',new HighlightClass(...ranges));else for(const range of ranges)for(const box of range.getClientRects()){if(box.bottom<0||box.top>innerHeight)continue;const mark=document.createElement('span');mark.style.cssText='position:absolute;border-bottom:2px dotted #d83838;left:'+box.left+'px;top:'+(box.bottom-2)+'px;width:'+box.width+'px;height:0';overlay!.append(mark);}}
  };
  const schedule=()=>{generation++;clearTimeout(timer);timer=window.setTimeout(()=>void run().catch(console.error),400);};
  document.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
  new MutationObserver(schedule).observe(host,{subtree:true,characterData:true,childList:true});
  window.JSBridge.on(e=>{if(e.type==='spellcheck-state')schedule();});schedule();
}
