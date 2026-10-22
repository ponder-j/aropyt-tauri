import type { DocEditor } from './editor';
import type { Text } from '@codemirror/state';
import { countUnit, documentStatistics, readingMinutes, statisticsSelectionLabel, statisticsPanelHtml, StatisticsState } from '../shared/document-statistics';
import { tableText } from './table-dom';

/** The bottom-bar count follows the selection; its popup keeps whole-document
 * totals. Keeping both in this renderer preserves the native editing focus. */
export class StatisticsControl {
  private readonly button: HTMLElement;
  private readonly panel: HTMLElement;
  private data!: StatisticsState;
  private doc?: Text;
  private pendingCount?: number;
  private speed: unknown;
  private total = documentStatistics('');
  constructor(private editor: DocEditor, private options: () => { settings: Record<string, any>; lang: 'zh' | 'en' }) {
    this.button = document.getElementById('footer-word-count')!;
    this.button.setAttribute('aria-haspopup', 'menu');
    this.panel = document.createElement('div'); this.panel.id = 'word-count-popover';
    this.panel.setAttribute('role', 'menu'); this.panel.setAttribute('aria-label', '字数统计'); this.panel.hidden = true;
    document.body.append(this.panel);
    this.button.addEventListener('mousedown', (event) => event.preventDefault());
    this.button.addEventListener('click', () => this.toggle());
    this.panel.addEventListener('mousedown', (event) => event.preventDefault());
    this.panel.addEventListener('click', (event) => {
      const unit = (event.target as HTMLElement).closest<HTMLElement>('[data-unit]')?.dataset.unit;
      if (unit) { void window.JSBridge.invoke('setting.put', 'wordCountUnit', countUnit(unit)); this.dismiss(); }
    });
    document.addEventListener('mousedown', (event) => {
      if (this.button.contains(event.target as Node) || this.panel.contains(event.target as Node)) return;
      this.dismiss();
    }, true);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.dismiss(); });
    window.addEventListener('blur', () => this.dismiss());
    document.addEventListener('selectionchange', () => this.update());
  }
  update(immediate = false): void {
    const { settings, lang } = this.options(), doc = this.editor.view.state.doc, speed = settings.readingSpeed ?? 382;
    this.speed = speed;
    if (doc !== this.doc) {
      this.doc = doc;
      // CodeMirror's immutable document already caches character/line totals.
      // Defer full word splitting while typing; caret movement reuses the cache.
      this.total = { ...this.total, characters: doc.length, lines: doc.lines };
      if (this.pendingCount !== undefined) window.cancelIdleCallback(this.pendingCount);
      this.pendingCount = window.requestIdleCallback(() => {
        this.pendingCount = undefined;
        if (doc !== this.doc) return;
        this.total = documentStatistics(doc.toString(), this.speed);
        this.update();
      }, { timeout: 500 });
    }
    if (immediate && this.pendingCount !== undefined) {
      window.cancelIdleCallback(this.pendingCount); this.pendingCount = undefined;
      this.total = documentStatistics(doc.toString(), speed);
    }
    this.total = { ...this.total, minutes: readingMinutes(this.total.words, speed) };
    const selection = this.editor.view.state.selection.main;
    let text = selection.empty ? '' : this.editor.view.state.sliceDoc(selection.from, selection.to);
    const nativeSelection = window.getSelection(), active = document.activeElement as HTMLElement | null;
    // Table cells have their own native selection rather than a CodeMirror range.
    if (active?.matches('td[data-row],th[data-row]') && this.editor.view.dom.contains(active)) {
      text = nativeSelection?.anchorNode && active.contains(nativeSelection.anchorNode) && active.contains(nativeSelection.focusNode) ? tableText(nativeSelection.getRangeAt(0).cloneContents()) : '';
    }
    this.data = { total: this.total, selected: text ? documentStatistics(text, speed) : null, lang, unit: countUnit(settings.wordCountUnit),
      visible: settings.showWordCount !== false };
    const label = this.button.querySelector('#footer-word-count-label')!;
    label.textContent = statisticsSelectionLabel(this.data);
    this.button.title = lang === 'zh' ? '字数统计' : 'Word count';
    this.button.setAttribute('aria-label', this.button.title);
    this.panel.lang = lang;
    this.button.hidden = !this.data.visible;
    if (!this.data.visible || settings.showStatusBar === false) this.dismiss();
    this.panel.innerHTML = statisticsPanelHtml(this.data);
  }
  toggle(): void {
    this.update(true);
    this.panel.hidden = !this.panel.hidden;
    this.button.setAttribute('aria-expanded', String(!this.panel.hidden));
  }
  dismiss(): void { this.panel.hidden = true; this.button.setAttribute('aria-expanded', 'false'); }
}
