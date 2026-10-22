import type { DocEditor } from './editor';
import { SPELL_LANGUAGES, SpellState } from '../shared/spellcheck';
import { renderDocument } from './md';

/** Menu choices apply to this document; Global Settings controls defaults. */
export class SpellcheckControl {
  private readonly button = document.getElementById('footer-spell-check')!;
  private readonly panel = document.createElement('div');
  private readonly search = document.createElement('input');
  private readonly modes = document.createElement('div');
  private readonly languages = document.createElement('div');
  private readonly global = document.createElement('button');
  private previousFocus: HTMLElement | null = null;
  private pendingSample?: number;
  private doc?: DocEditor['view']['state']['doc'];
  state: SpellState = { mode: 'auto', language: 'en-US', enabled: true };
  constructor(private editor: DocEditor, private options: () => { settings: Record<string, any>; lang: 'zh' | 'en' }) {
    this.panel.id = 'spell-check-popover'; this.panel.hidden = true; this.panel.setAttribute('role', 'menu');
    this.search.type = 'search'; this.search.className = 'spell-language-search';
    this.search.addEventListener('input', () => this.renderLanguages());
    this.modes.className = 'spell-modes'; this.languages.className = 'spell-languages';
    this.global.type = 'button'; this.global.className = 'spell-global-settings';
    this.global.addEventListener('click', () => { this.dismiss(); void window.JSBridge.invoke('window.openPreferences', 'editor'); });
    this.panel.append(this.search, this.modes, this.languages, this.global); document.body.append(this.panel);
    this.button.addEventListener('mousedown', event => event.preventDefault());
    this.button.addEventListener('click', () => this.toggle());
    this.panel.addEventListener('mousedown', event => { if (event.target !== this.search) event.preventDefault(); });
    this.panel.addEventListener('click', event => {
      const mode = (event.target as HTMLElement).closest<HTMLElement>('[data-spell-mode]')?.dataset.spellMode;
      if (mode) this.accept(mode);
    });
    this.panel.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return;
      const items = Array.from(this.panel.querySelectorAll<HTMLButtonElement>('[data-spell-mode]'));
      if (event.key === 'Enter' && document.activeElement === this.search) { event.preventDefault(); (items.find(b => b.classList.contains('spell-key-active')) || items[0])?.click(); return; }
      if (event.key === 'Enter') return;
      event.preventDefault();
      let index = items.findIndex(b => b.classList.contains('spell-key-active'));
      index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle('spell-key-active', i === index)); items[index]?.scrollIntoView({ block: 'nearest' });
    });
    document.addEventListener('mousedown', event => { if (!this.button.contains(event.target as Node) && !this.panel.contains(event.target as Node)) this.dismiss(); }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !this.panel.hidden) { event.preventDefault(); this.dismiss(true); } });
    window.addEventListener('blur', () => this.dismiss());
    window.JSBridge.on(event => { if (event.type === 'spellcheck-state') this.apply(event.arg); });
    void window.JSBridge.invoke('spellcheck.state').then(state => this.apply(state));
    this.update(); this.documentChanged();
  }
  private apply(state: SpellState): void {
    const changed = this.state.enabled !== state.enabled; this.state = state;
    if (changed) this.editor.configure({ ...this.options().settings, spellCheck: state.enabled });
    this.update();
  }
  private accept(mode: string): void { void window.JSBridge.invoke('spellcheck.configure', mode).then(state => this.apply(state)); this.dismiss(true); }
  private option(mode: string, label: string, code = ''): HTMLButtonElement {
    const item = document.createElement('button'); item.type = 'button'; item.dataset.spellMode = mode;
    item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(this.state.mode === mode));
    const name = document.createElement('span'); name.textContent = label; item.append(name);
    if (code) { const tag = document.createElement('span'); tag.className = 'spell-language-code'; tag.textContent = code.toUpperCase(); item.append(tag); }
    return item;
  }
  private renderLanguages(): void {
    const query = this.search.value.trim().toLocaleLowerCase(); this.languages.replaceChildren();
    for (const [code, name] of SPELL_LANGUAGES) if (!query || `${code} ${name}`.toLocaleLowerCase().includes(query)) this.languages.append(this.option(code, name, code));
  }
  update(): void {
    const { settings, lang } = this.options(), zh = lang === 'zh';
    this.button.title = zh ? '拼写检查' : 'Spell Check'; this.button.setAttribute('aria-label', this.button.title);
    this.panel.setAttribute('aria-label', this.button.title); this.panel.lang = lang;
    this.search.placeholder = zh ? '选择拼写检查语言' : 'Select spell check language'; this.search.setAttribute('aria-label', this.search.placeholder);
    this.modes.replaceChildren(this.option('auto', zh ? '自动检测语言' : 'Auto Detect Language'), this.option('off', zh ? '不使用拼写检查' : 'Disable Spell Check'));
    this.global.textContent = zh ? '全局设置…' : 'Global Settings…'; this.renderLanguages();
    this.button.classList.toggle('spelling-disabled', !this.state.enabled);
    if (settings.showStatusBar === false) this.dismiss();
  }
  documentChanged(): void {
    const doc = this.editor.view.state.doc;
    if (doc === this.doc) return; this.doc = doc;
    if (this.pendingSample !== undefined) window.cancelIdleCallback(this.pendingSample);
    this.pendingSample = window.requestIdleCallback(() => {
      this.pendingSample = undefined;
      // Sample the document start even when CodeMirror's DOM viewport is elsewhere.
      const root = document.createElement('div'); root.innerHTML = renderDocument(doc.toString()).html;
      const blocks = root.querySelectorAll('#write p,#write h1,#write h2,#write h3,#write h4,#write h5,#write h6');
      let text = '', count = 0;
      for (const block of blocks) {
        if (++count > 4) break;
        const clone = block.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('code,a,strong,em,s,mark,u,img,.md-inline-math,.md-math').forEach(node => node.remove());
        text += ' ' + clone.textContent; if (text.length > 100) break;
      }
      void window.JSBridge.invoke('spellcheck.sample', text.trim());
    }, { timeout: 500 });
  }
  reset(): void { void window.JSBridge.invoke('spellcheck.reset').then(state => this.apply(state)); this.doc = undefined; this.documentChanged(); }
  toggle(): void {
    if (!this.panel.hidden) { this.dismiss(true); return; }
    this.previousFocus = document.activeElement as HTMLElement; this.search.value = ''; this.update(); this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true'); this.search.focus({ preventScroll: true });
  }
  dismiss(restore = false): void {
    const opened = !this.panel.hidden; this.panel.hidden = true; this.button.setAttribute('aria-expanded', 'false');
    if (opened && restore) this.previousFocus?.focus({ preventScroll: true });
  }
}
