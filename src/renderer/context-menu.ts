import type { DocEditor } from './editor';
import { blockAt, reindentCode } from './editing-commands';
import { blockRanges, standaloneImage, documentReferences } from './md';
import { codeFence } from './code-fences';
import { tableSelection, focusTableRange } from './table-editor';
import { IMAGE_ZOOM_LEVELS, replaceImageSource, ImageSourceRange } from './image-actions';
import { shortcutHint } from '../shared/shortcuts';

interface Item {
  key: string; label?: string; group?: string; icon?: string; shortcut?: string;
  disabled?: boolean; checked?: boolean; children?: Item[]; menuId?: string; row?: Item[];
  run?: () => unknown;
}
interface Options {
  lang: 'zh' | 'en'; settings: Record<string, any>; file: string | null;
  spelling: boolean; resolveImage(source: string): string;
}
type Invoke = <T = any>(method: string, ...args: unknown[]) => Promise<T>;
interface RightClick { bookmark: Bookmark; image: ImageSourceRange | null; cell: HTMLElement | null }
interface Bookmark {
  doc: string; selection: DocEditor['view']['state']['selection']; focus: HTMLElement | null; range?: Range; cellRange?: { from: number; to: number };
}

/** DOM menus deliberately keep focus in the editor. A menu click restores the
 * saved selection before dispatching an existing editing command. */
export class EditorContextMenu {
  private panels: HTMLElement[] = [];
  private current?: Bookmark;
  private rightClick?: RightClick;
  private active?: HTMLButtonElement;
  private closeTimer?: number;
  private generation = 0;
  private point = { x: 0, y: 0 };
  constructor(private editor: DocEditor, private options: () => Options,
    private invoke: Invoke, private action: (action: string, arg?: unknown) => unknown,
    private notify: (message: string, kind?: 'info' | 'success' | 'error') => void) {
    const dom = editor.view.dom;
    dom.addEventListener('mousedown', event => {
      // Blink otherwise moves a collapsed caret on right mouse down.
      this.rightClick = undefined;
      if (event.button === 2 && !this.input(event.target)) {
        const target = event.target as HTMLElement;
        this.rightClick = { bookmark: this.bookmark(), image: this.editor.imageAt(target), cell: target.closest('td[data-row],th[data-row]') };
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
    dom.addEventListener('contextmenu', event => {
      if (this.input(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // WebKit can focus a different contenteditable even after cancelling
      // right mousedown. Restore the selection captured before that focus.
      const click = this.rightClick; this.rightClick = undefined;
      if (click && !this.restore(click.bookmark)) return;
      this.open(event, click);
    }, true);
    document.addEventListener('mousedown', event => {
      if (!this.panels.some(panel => panel.contains(event.target as Node))) this.dismiss();
    }, true);
    document.addEventListener('keydown', event => { this.rightClick = undefined; this.keydown(event); }, true);
    document.addEventListener('scroll', event => {
      if (this.panels.length && !this.panels.some(panel => panel.contains(event.target as Node))) this.dismiss();
    }, true);
    window.addEventListener('resize', () => this.dismiss());
    window.addEventListener('aropyt-language-changed', () => this.dismiss());
    window.addEventListener('blur', () => { this.rightClick = undefined; this.dismiss(); });
  }
  private input(target: EventTarget | null): boolean { return !!(target as HTMLElement)?.closest('input,textarea,select'); }
  dismiss(): void {
    this.generation++; window.clearTimeout(this.closeTimer);
    this.panels.forEach(panel => panel.remove()); this.panels = []; this.active = undefined;
  }
  private bookmark(): Bookmark {
    this.editor.syncNativeSelection();
    const native = window.getSelection();
    return { doc: this.editor.value, selection: this.editor.view.state.selection, focus: document.activeElement as HTMLElement,
      range: native?.rangeCount ? native.getRangeAt(0).cloneRange() : undefined, cellRange: tableSelection(this.editor.view) };
  }
  private restore(bookmark = this.current): boolean {
    if (!bookmark || bookmark.doc !== this.editor.value) return false;
    if (!this.editor.view.state.selection.eq(bookmark.selection)) this.editor.view.dispatch({ selection: bookmark.selection });
    if (bookmark.cellRange && focusTableRange(this.editor.view, bookmark.cellRange.from, bookmark.cellRange.to)) return true;
    if (bookmark.focus?.isConnected) bookmark.focus.focus({ preventScroll: true });
    if (bookmark.range?.startContainer.isConnected && bookmark.range.endContainer.isConnected) {
      const native = window.getSelection(); native?.removeAllRanges(); native?.addRange(bookmark.range);
    }
    return true;
  }
  private command(action: string): () => unknown { return () => this.action(action); }
  private replaceImage(range: ImageSourceRange, source: string, focus = false): void {
    if (!this.editor.replaceImage(range, source, focus)) this.notify(this.options().lang === 'zh' ? '文稿已改变，图片引用未更新。' : 'The document changed; the image reference was not updated.', 'info');
  }
  private async accept(item: Item): Promise<void> {
    if (item.disabled) return;
    if (item.children) { const button = this.active; if (button) this.submenu(button, item, true); return; }
    this.dismiss(); if (!this.restore()) return;
    try { await item.run?.(); } catch (error) { this.notify(String(error instanceof Error ? error.message : error), 'error'); }
  }
  private open(event: MouseEvent, click?: RightClick): void {
    this.dismiss(); this.current = this.bookmark();
    const native = window.getSelection(), target = event.target as HTMLElement;
    this.point = { x: event.clientX, y: event.clientY };
    const source = this.editor.isSourceMode;
    const { lang, settings, spelling, file, resolveImage } = this.options(), zh = lang === 'zh';
    const text = (cn: string, en: string) => zh ? cn : en;
    const mod = 'Ctrl+', shift = 'Shift+';
    const cmd = (key: string, cn: string, en: string, shortcut = ''): Item => ({ key, label: text(cn, en),
      shortcut: shortcutHint(settings.keyBinding?.[key] || shortcut), run: this.command(key) });
    const sep = (group?: string): Item => ({ key: 'divider', group });
    const clipboard = (key: string, cn: string, en: string, icon: string): Item => ({ key, label: text(cn, en), icon,
      run: key === 'del' ? this.command('del') : () => this.invoke('webContents.' + key) });
    const clip = [clipboard('cut', '剪切', 'Cut', 'ty-cut'), clipboard('copy', '复制', 'Copy', 'ty-copy'),
      clipboard('paste', '粘贴', 'Paste', 'ty-paste'), clipboard('del', '删除选中内容', 'Delete Selected', 'ty-delete1')];
    if (source) { this.show(clip.slice(0, 3).map(({ icon, ...item }) => item), 'context-menu-for-source'); return; }
    const imageRange = click?.image || this.editor.imageAt(target), image = imageRange && standaloneImage(imageRange.source, documentReferences(this.editor.value));
    const cell = click?.cell || target.closest<HTMLElement>('td[data-row],th[data-row]'), table = cell?.closest<HTMLElement>('.md-table-widget');
    const preview = target.closest<HTMLElement>('.cm-diagram-preview,.md-diagram,.md-math-block,.cm-inline-math-widget,.md-table-math-preview,mjx-container');
    const raw = target.closest<HTMLElement>('.md-block-widget[data-kind="html_block"],.md-block-widget[data-kind="math_block"]');
    const line = target.closest<HTMLElement>('.cm-line');
    let pos: number | null = null; try { if (line) pos = this.editor.view.posAtDOM(line); } catch { /* clicked a widget */ }
    const block = blockAt(this.editor);
    const pointedBlock = pos === null ? null : blockRanges(this.editor.value).find(b => {
      const n = this.editor.view.state.doc.lineAt(pos!).number - 1; return n >= b.startLine && n < b.endLine;
    });
    const fence = pointedBlock && codeFence(this.editor.view.state, pointedBlock);
    const mathBlock = pointedBlock?.kind === 'math_block' ? pointedBlock : null;
    const mathFrom = mathBlock ? this.editor.view.state.doc.line(mathBlock.startLine + 1) : null;
    const mathLast = mathBlock ? this.editor.view.state.doc.line(Math.min(mathBlock.endLine, this.editor.view.state.doc.lines)) : null;
    const mathStart = mathFrom ? mathFrom.from + mathFrom.text.indexOf('$$') + 2 : 0;
    const mathEnd = mathLast ? mathLast.from + mathLast.text.lastIndexOf('$$') : 0;
    const mathBodyFrom = mathStart + (this.editor.view.state.sliceDoc(mathStart, mathStart + 1) === '\n' ? 1 : 0);
    const code = !preview && (line?.classList.contains('cm-code-line') || mathBlock) ? fence || (mathBlock && {
      bodyFrom: mathBodyFrom,
      bodyTo: Math.max(mathBodyFrom, mathEnd - (this.editor.view.state.sliceDoc(mathEnd - 1, mathEnd) === '\n' ? 1 : 0)), lang: 'math',
    }) : null;
    const mathRoot = target.closest<HTMLElement>('.md-math-block,.md-inline-math,.cm-inline-math-widget,.md-table-math-preview');
    const mediaRoot = target.closest<HTMLElement>('.cm-diagram-preview,.md-diagram') || mathRoot;
    const svg = mediaRoot?.querySelector('svg');
    const tex = (mathRoot?.dataset.tex || mathRoot?.querySelector<HTMLElement>('[data-tex]')?.dataset.tex ||
      (code?.lang === 'math' ? this.editor.view.state.sliceDoc(code.bodyFrom, code.bodyTo) : '')).trim();
    const link = target.closest<HTMLElement>('a[href],.md-link,[data-href]');
    const href = link?.getAttribute('href') || link?.dataset.href;
    const video = target.closest('video');
    const selected = native?.toString() || '';
    const items: Item[] = [];
    const group = (name: string, entries: Item[]) => items.push(...entries.map(item => ({ ...item, group: name })));
    if (image && imageRange) {
      const src = resolveImage(image.src), local = /^file:/i.test(src);
      const update = (value: string) => {
        const updated = replaceImageSource(imageRange.source, value, documentReferences(this.editor.value));
        this.replaceImage(imageRange, updated);
      };
      const transfer = (mode: string) => async () => { const value = await this.invoke<string | null>('images.transfer', src, mode, file); if (value) update(value); };
      group('image', [
        { key: local ? 'reveal-img-in-finder' : 'reveal-img-in-browser', label: text(local ? '打开图片位置…' : '在浏览器中打开图片…', local ? 'Open Image Location…' : 'Open Image in Browser…'),
          run: () => this.invoke(local ? 'images.reveal' : 'shell.openExternal', src) }, sep(),
        { key: 'select-img-target', label: text('复制图片到…', 'Copy Image to…'), run: transfer('copy') },
        ...(local ? [{ key: 'select-img-target-move', label: text('重命名 / 移动图片到…', 'Rename or Move Image to…'), run: transfer('move') }] : []),
        { key: 'upload-img', label: text('上传图片', 'Upload Image'), run: async () => { const [url] = await this.invoke<string[]>('images.prepare', [src], file, true); if (url) update(url); } },
        { key: 'zoom-img', label: text('缩放图片', 'Zoom Image'), menuId: 'zoom-img-menu', children: IMAGE_ZOOM_LEVELS.flatMap(scale => [
          ...([100,150].includes(scale) ? [sep()] : []), { key: 'image:zoom:' + scale, label: scale + '%', run: this.command('image:zoom:' + scale) }]) },
        { key: 'switch-img-syntax', label: text('转换图片语法', 'Switch Image Syntax'), menuId: 'switch-img-syntax-menu', children: [
          { key: 'image:markdown', label: 'Markdown ![alt](src)', checked: image.kind === 'markdown', run: this.command('image:markdown') },
          { key: 'image:html', label: 'HTML <img src="src" alt="alt" />', checked: image.kind === 'html', run: this.command('image:html') }] },
        { key: local ? 'delete-img-file' : 'delete-img', label: text(local ? '删除图片文件' : '删除图片', local ? 'Delete Image File' : 'Delete Image'),
          run: async () => { if (local) {
              const answer = await this.invoke('dialog.showMessageBox', { type: 'warning', title: text('删除图片', 'Delete Image'),
                message: text('将图片文件移到废纸篓？', 'Move the image file to Trash?'), detail: src,
                buttons: [text('移到废纸篓', 'Move to Trash'), text('取消', 'Cancel')], defaultId: 1, cancelId: 1 });
              if (answer.response !== 0 || !await this.invoke('images.trash', src)) return;
            }
            this.replaceImage(imageRange, '', true); } }, sep(),
      ]);
      clip.forEach(item => item.disabled = true);
    }
    if (video) group('video', [{ key: 'play', label: text('播放', 'Play'), run: () => video.play() }, { key: 'pause', label: text('暂停', 'Pause'), run: () => video.pause() }, sep()]);
    if (href) group('hyperlink', [{ key: 'jumpto', label: text('打开链接', 'Open Link'), shortcut: shortcutHint(mod) + text('单击', 'Click'), run: () => this.openLink(href) }, sep()]);
    const word = !image && !mathRoot && (!code || settings.spellcheckForCodeAndLink) && (!href || settings.spellcheckForCodeAndLink) && spelling ? this.wordAt(event) : null;
    if (selected.trim() && !selected.includes('\n') && !image && !mathRoot) group('search', [{ key: 'search-with', label: text('搜索', 'Search With'), menuId: 'search-menu', children:
      [['Google', 'https://www.google.com/search?q='], ['Bing', 'https://www.bing.com/search?q='], [text('百度', 'Baidu'), 'https://www.baidu.com/s?wd=']].map(([label, url]) => ({ key: 'search:' + label, label, run: () => this.invoke('shell.openExternal', url + encodeURIComponent(selected)) })) }, sep()]);
    if (raw && !code) group('edit-block', [{ key: 'edit', label: text('编辑', 'Edit'), shortcut: text('单击', 'Click'), run: () => raw.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })) }, clipboard('copy', '复制', 'Copy', 'ty-copy')]);
    else group('copy-paste', [{ key: 'clipboard', row: clip }]);
    if (href) group('hyperlink', [{ key: 'copy_link', label: text('复制链接地址', 'Copy Link Address'), run: () => this.invoke('clipboard.writeRich', href, '') }]);
    const emoji = target.closest<HTMLElement>('.md-emoji.md-expand [data-emoji]')?.dataset.emoji;
    if (emoji) group('emoji', [{ key: 'copy-emoji', label: text('复制 ', 'Copy ') + '“' + emoji + '”', run: () => this.invoke('clipboard.writeRich', emoji, '') }]);
    if (image) group('image', [{ key: 'copy-img', label: text('拷贝图片', 'Copy Image Content'), run: () => this.invoke('images.copyImage', resolveImage(image.src)) }]);
    const copyAs = [cmd('copyAsMarkdown', '复制为 Markdown', 'Copy as Markdown', mod + shift + 'C'),
      cmd('copyAsHtmlCode', '复制为 HTML 代码', 'Copy as HTML Code'), cmd('copySimple', '复制为无样式 HTML', 'Copy without Theme Styling')];
    const media = svg ? this.media(svg) : null;
    if (media) copyAs.push(sep(), { key: 'copy_as_image', label: text('复制为图片', 'Copy as Image'), run: () => this.invoke('media.output', media, 'copy') });
    if (tex) {
      const mathml = () => this.mathml(tex, !!mathRoot?.classList.contains('md-math-block'));
      copyAs.push({ key: 'copy_as_word', label: text('复制到 MS Word', 'Copy to MS Word'), run: async () => { const xml = await mathml(); return this.invoke('clipboard.writeRich', tex, `<html xmlns:m="http://www.w3.org/1998/Math/MathML"><body>${xml}</body></html>`); } },
        { key: 'copy_as_mathml', label: text('复制为 MathML', 'Copy as MathML'), run: async () => this.invoke('clipboard.writeRich', await mathml(), '') },
        { key: 'copy_as_math_tex', label: text('复制为 TeX', 'Copy as TeX'), run: () => this.invoke('clipboard.writeRich', tex, '') });
    }
    copyAs.push(sep(), { ...cmd('pasteAsPlain', '粘贴为纯文本', 'Paste as Plain Text', mod + shift + 'V'), disabled: !!image || !!raw });
    group('copy-paste', [{ key: 'copy-as', label: text('复制 / 粘贴为…', 'Copy / Paste As…'), menuId: 'edit-menu', children: copyAs }]);
    if (code) {
      const content = this.editor.view.state.sliceDoc(code.bodyFrom, code.bodyTo);
      const indent = (selectedOnly: boolean) => () => {
        const state = this.editor.view.state, selection = state.selection.main;
        if (selectedOnly && selection.empty) return;
        const last = selection.to > selection.from && state.doc.lineAt(selection.to).from === selection.to ? selection.to - 1 : selection.to;
        const from = selectedOnly ? Math.max(code.bodyFrom, state.doc.lineAt(selection.from).from) : code.bodyFrom;
        const to = selectedOnly ? Math.min(code.bodyTo, state.doc.lineAt(last).to) : code.bodyTo;
        if (to < from) return;
        // Reindent against the surrounding block, then replace only selected
        // lines. Formatting an isolated line loses the enclosing brace depth.
        const lang = selectedOnly && /^(json|jsonc|json5)$/.test(code.lang) ? 'javascript' : code.lang;
        const formatted = reindentCode(content, lang, Number(settings.codeIndentSize || 4));
        const startLine = state.sliceDoc(code.bodyFrom, from).split('\n').length - 1;
        const endLine = state.sliceDoc(code.bodyFrom, to).split('\n').length - 1;
        const insert = selectedOnly ? formatted.split('\n').slice(startLine, endLine + 1).join('\n') : formatted;
        this.editor.view.dispatch({ changes: { from, to, insert }, userEvent: 'input' });
      };
      group('code', [{ key: 'copy-all-code', label: text('复制代码块内容', 'Copy Code Content'), run: () => this.invoke('clipboard.writeRich', content, '') },
        { key: 'format-selected-code', label: text('为选中内容调整缩进', 'Auto Indent Selected Code'), disabled: this.editor.view.state.selection.main.empty ||
          this.editor.view.state.selection.main.to <= code.bodyFrom || this.editor.view.state.selection.main.from >= code.bodyTo, run: indent(true) },
        { key: 'format-all-code', label: text('为整个代码块调整缩进', 'Auto Indent Whole Code'), run: indent(false) }]);
    }
    if (media) group('adv-media', [{ key: 'download-as', label: text(mathRoot ? '公式另存为…' : '图表另存为…', 'Save Media As…'), run: () => this.invoke('media.output', media, 'save') }]);
    items.push(sep());
    if (!code) {
      group('inline-style', [{ key: 'inline-style', row: [
        { ...cmd('strong', '加粗', 'Strong'), icon: 'ty-bold' }, { ...cmd('emphasis', '斜体', 'Emphasis'), icon: 'ty-italic' },
        { ...cmd('inlineCode', '行内代码', 'Code'), icon: 'ty-code' }, { ...cmd('link', '超链接', 'Hyperlink'), icon: 'ty-link-icon' }] }]);
      group('block-wrap', [{ key: 'block-wrap', row: [
        { ...cmd('insertQuote', '引用', 'Quote'), icon: 'ty-quote' }, { ...cmd('insertOrderedList', '有序列表', 'Ordered List'), icon: 'ty-number' },
        { ...cmd('insertUnorderedList', '无序列表', 'Unordered List'), icon: 'ty-bullet-list' }, { ...cmd('insertTaskList', '任务列表', 'Task List'), icon: 'ty-check' }] }]);
      if (/list|blockquote/.test(block?.kind || '')) group('block-tab', [{ key: 'block-tab', row: [{ ...cmd('outdent', '减少缩进', 'Outdent'), icon: 'ty-left' }, { ...cmd('indent', '增加缩进', 'Indent'), icon: 'ty-right' }] }]);
      items.push(sep());
    }
    if (table && cell) {
      const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
      const rows = table.querySelectorAll('tr').length, cols = table.querySelectorAll('th').length;
      const tableCommand = (key: string, cn: string, en: string, shortcut = '', disabled = false): Item => ({ key, label: text(cn, en), shortcut: shortcutHint(settings.keyBinding?.[key] || shortcut), disabled, run: () => {
        if (key === 'copyTable') return this.invoke('clipboard.writeRich', this.editor.view.state.sliceDoc(Number(table.dataset.from), Number(table.dataset.to)), table.querySelector('table')?.outerHTML || '');
        if (document.activeElement !== cell) cell.focus({ preventScroll: true });
        return this.action(key);
      } });
      group('table', [{ key: 'table', label: text('表格', 'Table'), menuId: 'table-menu', children: [
        tableCommand('tableRowBefore', '在上方插入行', 'Add Row Above'), tableCommand('tableRowAfter', '在下方插入行', 'Add Row Below', mod + 'Enter'),
        tableCommand('tableColumnBefore', '在左侧插入列', 'Add Column Before'), tableCommand('tableColumnAfter', '在右侧插入列', 'Add Column After'), sep(),
        tableCommand('tableRowUp', '向上移动行', 'Move Row Up', 'Alt+↑', row === 0), tableCommand('tableRowDown', '向下移动行', 'Move Row Down', 'Alt+↓', row === rows - 1),
        tableCommand('tableColumnLeft', '向左移动列', 'Move Column Left', 'Alt+←', col === 0), tableCommand('tableColumnRight', '向右移动列', 'Move Column Right', 'Alt+→', col === cols - 1), sep(),
        tableCommand('tableDeleteRow', '删除行', 'Delete Row', mod + shift + 'Backspace'), tableCommand('tableDeleteColumn', '删除列', 'Delete Column'), sep(),
        tableCommand('copyTable', '复制表格', 'Copy Table'), tableCommand('prettifyTable', '整理表格', 'Prettify'), sep(), tableCommand('deleteTable', '删除表格', 'Delete Table') ] }]);
    } else if (!raw && !mathBlock) {
      const level = block?.kind === 'heading_open' ? /^\s*(#{1,6})\s/.exec(block.text)?.[1].length || 0 : 0;
      const name = level ? text(['', '一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'][level], 'Heading ' + level) :
        text(block?.kind === 'fence' ? '代码块' : block?.kind === 'blockquote_open' ? '引用' : /list/.test(block?.kind || '') ? '列表' : '段落', block?.kind === 'fence' ? 'Code Fences' : block?.kind === 'blockquote_open' ? 'Quote' : /list/.test(block?.kind || '') ? 'List' : 'Paragraph');
      group('block-style', [{ key: 'block-style', label: name, menuId: 'block-style-menu', children: [
        ...[1,2,3,4,5,6].map(n => ({ ...cmd('heading:' + n, ['', '一级标题', '二级标题', '三级标题', '四级标题', '五级标题', '六级标题'][n], 'Heading ' + n, mod + n), checked: level === n })), sep(),
        { ...cmd('heading:0', '段落', 'Paragraph', mod + '0'), checked: level === 0 }] }]);
    }
    group('insert', [{ key: 'insert', label: text('插入', 'Insert'), menuId: 'insert-menu', children: [
      cmd('insertImage', '图片', 'Image', mod + shift + 'I'), cmd('insertFootnote', '脚注', 'Footnotes'), cmd('insertLinkRef', '链接引用', 'Link Reference'),
      cmd('insertHr', '水平分割线', 'Horizontal Line'), cmd('insertTable', '表格', 'Table', mod + shift + 'T'), cmd('insertFences', '代码块', 'Code Fences', mod + shift + 'K'),
      cmd('insertMathBlock', '公式块', 'Math Block', mod + shift + 'M'), cmd('insertToc', '目录', 'Table of Contents'), cmd('insertFrontMatter', 'YAML 元数据', 'YAML Front Matter'), sep(),
      cmd('insertParagraphBefore', '段落（上方）', 'Paragraph (Before)'), cmd('insertParagraphAfter', '段落（下方）', 'Paragraph (After)') ] }]);
    if (raw || mediaRoot && !mathRoot?.matches('.cm-inline-math-widget,.md-inline-math,.md-table-math-preview')) group('delete-block', [sep(), { key: 'delete-block', label: text(mathRoot ? '删除公式块' : mediaRoot ? '删除图表' : '删除 HTML 块', 'Delete Block'), run: () => {
      const from = raw?.dataset.line || mediaRoot?.closest<HTMLElement>('[data-line]')?.dataset.line;
      if (from !== undefined) this.editor.view.dispatch({ selection: { anchor: this.editor.view.state.doc.line(Number(from) + 1).from } });
      return this.action('deleteBlock');
    } }]);
    this.show(items, 'context-menu');
    if (image && imageRange) void this.imageTarget(imageRange, resolveImage(image.src), file, this.generation).catch(() => {});
    if (word) void this.spelling(word, this.generation);
  }
  private async imageTarget(range: ImageSourceRange, source: string, file: string | null, generation: number): Promise<void> {
    const name = await this.invoke<string | null>('images.target', source, file);
    if (!name || generation !== this.generation) return;
    const zh = this.options().lang === 'zh';
    const entry = (move: boolean): Item => ({ key: move ? 'move-img-to-target' : 'copy-img-to-target', group: 'image',
      label: (zh ? move ? '移动到 ' : '复制到 ' : move ? 'Move to ' : 'Copy to ') + name,
      run: async () => { const value = await this.invoke<string | null>('images.transfer', source, move ? 'move-target' : 'copy-target', file); if (value) this.replaceImage(range, replaceImageSource(range.source, value, documentReferences(this.editor.value))); } });
    const target = this.panels[0]?.querySelector('[data-key="select-img-target"]');
    target?.before(this.element(entry(false), 0));
    if (/^file:/i.test(source)) target?.before(this.element(entry(true), 0));
    this.position(this.panels[0], this.point.x, this.point.y);
  }
  private async openLink(href: string): Promise<void> {
    if (href.startsWith('#')) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
    else if (/^(https?:|mailto:)/i.test(href)) await this.invoke('shell.openExternal', href);
    else await this.invoke('images.open', this.options().resolveImage(href));
  }
  private media(svg: SVGSVGElement): { svg: string; width: number; height: number } {
    const rect = svg.getBoundingClientRect(), clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', String(Math.ceil(rect.width))); clone.setAttribute('height', String(Math.ceil(rect.height)));
    clone.style.color = getComputedStyle(svg).color; clone.style.maxWidth = 'none';
    return { svg: new XMLSerializer().serializeToString(clone), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  }
  private async mathml(tex: string, display: boolean): Promise<string> {
    const mj = (window as any).MathJax; await mj.startup.promise;
    if (mj.tex2mmlPromise) return mj.tex2mmlPromise(tex, { display });
    if (mj.tex2mml) return mj.tex2mml(tex, { display });
    const node = mj.startup.document.convert(tex, { display, end: 40 });
    return mj.startup.toMML(node);
  }
  private wordAt(event: MouseEvent): { text: string; range: Range; from?: number; to?: number } | null {
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range || range.startContainer.nodeType !== Node.TEXT_NODE || !this.editor.view.dom.contains(range.startContainer)) return null;
    const node = range.startContainer, source = node.textContent || '', offset = range.startOffset;
    const match = [...source.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)].find(m => offset >= m.index! && offset <= m.index! + m[0].length);
    if (!match || /\p{Script=Han}/u.test(match[0])) return null;
    range.setStart(node, match.index!); range.setEnd(node, match.index! + match[0].length);
    const result: { text: string; range: Range; from?: number; to?: number } = { text: match[0], range };
    if (!(node.parentElement?.closest('td[data-row],th[data-row]'))) try { result.from = this.editor.view.posAtDOM(node, match.index!); result.to = this.editor.view.posAtDOM(node, match.index! + match[0].length); } catch { return null; }
    return result;
  }
  private async spelling(word: NonNullable<ReturnType<EditorContextMenu['wordAt']>>, generation: number): Promise<void> {
    try {
      const result = await this.invoke<{ misspelled: boolean; learned: boolean; suggestions: string[] }>('spellcheck.inspect', word.text);
      if (this.generation !== generation || (!result.misspelled && !result.learned)) return;
      const zh = this.options().lang === 'zh', items: Item[] = result.suggestions.slice(0, 6).map(value => ({ key: 'spell:' + value, label: value, group: 'spell-check', run: () => {
        if (word.from !== undefined) this.editor.view.dispatch({ changes: { from: word.from, to: word.to, insert: value }, userEvent: 'input' });
        else if (word.range.startContainer.isConnected) {
          const native = window.getSelection(); native?.removeAllRanges(); native?.addRange(word.range);
          document.execCommand('insertText', false, value);
        }
      } }));
      if (items.length) items.push({ key: 'divider', group: 'spell-check' });
      items.push({ key: result.learned ? 'unlearn' : 'learn', group: 'spell-check', label: zh ? result.learned ? '取消学习拼写' : '学习拼写' : result.learned ? 'Unlearn Spelling' : 'Learn Spelling', run: () => this.invoke('spellcheck.learn', word.text, result.learned) }, { key: 'divider', group: 'spell-check' });
      const panel = this.panels[0]; for (const item of items.reverse()) panel.prepend(this.element(item, 0)); this.position(panel, this.point.x, this.point.y);
    } catch { /* No spelling group when the dictionary has no result. */ }
  }
  private show(items: Item[], id: string): void {
    const panel = this.panel(items, id, 0); this.panels.push(panel); this.position(panel, this.point.x, this.point.y);
  }
  private panel(items: Item[], id: string, depth: number): HTMLElement {
    const panel = document.createElement('ul'); panel.id = id; panel.className = 'editor-context-menu'; panel.setAttribute('role', 'menu'); panel.setAttribute('aria-label', this.options().lang === 'zh' ? '右键菜单' : 'Context Menu');
    panel.dataset.depth = String(depth); panel.lang = this.options().lang;
    panel.addEventListener('mousedown', event => event.preventDefault());
    panel.addEventListener('contextmenu', event => event.preventDefault());
    panel.addEventListener('mouseenter', () => window.clearTimeout(this.closeTimer));
    panel.addEventListener('mouseleave', () => { this.closeTimer = window.setTimeout(() => this.closeAfter(Math.max(0, depth - 1)), 250); });
    for (const item of items) panel.append(this.element(item, depth)); document.body.append(panel); return panel;
  }
  private element(item: Item, depth: number): HTMLElement {
    const li = document.createElement('li'); li.dataset.group = item.group || ''; li.dataset.key = item.key;
    if (item.key === 'divider') { li.className = 'context-divider'; li.setAttribute('role', 'separator'); return li; }
    li.setAttribute('role', 'none');
    if (item.row) { li.className = 'context-button-row'; for (const button of item.row) li.append(this.button(button, depth)); }
    else li.append(this.button(item, depth)); return li;
  }
  private button(item: Item, depth: number): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.tabIndex = -1; button.dataset.key = item.key;
    button.dataset.depth = String(depth); button.disabled = !!item.disabled; button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked));
    if (item.icon) { button.className = 'context-icon-button'; button.title = item.label || ''; button.setAttribute('aria-label', item.label || '');
      const icon = document.createElement('i'); icon.className = (item.icon.startsWith('ty-') ? 'ty-icon ' : 'fa ') + item.icon; icon.setAttribute('aria-hidden', 'true'); button.append(icon);
    } else {
      const label = document.createElement('span'); label.className = 'context-label'; label.textContent = item.label || ''; button.append(label);
      if (item.shortcut) { const shortcut = document.createElement('span'); shortcut.className = 'context-shortcut'; shortcut.textContent = item.shortcut; button.append(shortcut); }
      if (item.children) { button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false'); const arrow = document.createElement('i'); arrow.className = 'fa fa-caret-right'; button.append(arrow); }
    }
    (button as any).__contextItem = item;
    button.addEventListener('mouseenter', () => {
      window.clearTimeout(this.closeTimer); this.highlight(button); this.closeAfter(depth);
      if (item.children && !item.disabled) this.submenu(button, item);
    });
    button.addEventListener('click', () => { this.highlight(button); void this.accept(item); }); return button;
  }
  private highlight(button: HTMLButtonElement): void {
    this.active?.classList.remove('context-key-active'); this.active = button; button.classList.add('context-key-active');
    const panel = button.closest('.editor-context-menu'); if (panel) panel.setAttribute('aria-activedescendant', button.id ||= 'context-item-' + Math.random().toString(36).slice(2));
  }
  private closeAfter(depth: number): void {
    const oldActive = this.active;
    for (const panel of this.panels.splice(depth + 1)) panel.remove();
    const parent = this.panels[depth]; parent?.querySelectorAll<HTMLButtonElement>('[aria-expanded="true"]').forEach(button => {
      if (oldActive && !oldActive.isConnected) this.highlight(button);
      button.setAttribute('aria-expanded', 'false'); button.classList.remove('context-parent-active');
    });
  }
  private submenu(button: HTMLButtonElement, item: Item, enter = false): void {
    const depth = Number(button.dataset.depth); this.closeAfter(depth);
    button.classList.add('context-parent-active'); button.setAttribute('aria-expanded', 'true');
    const panel = this.panel(item.children!, item.menuId || item.key + '-menu', depth + 1); this.panels.push(panel);
    const rect = button.getBoundingClientRect(), box = panel.getBoundingClientRect();
    this.position(panel, rect.right + box.width + 6 > innerWidth ? rect.left - box.width - 6 : rect.right + 6, rect.top - 5);
    if (enter) { const first = panel.querySelector<HTMLButtonElement>('button:not(:disabled)'); if (first) this.highlight(first); }
  }
  private position(panel: HTMLElement, x: number, y: number): void {
    // getBoundingClientRect is in physical CSS pixels even when body is zoomed.
    const zoom = Number(getComputedStyle(document.body).zoom) || 1;
    panel.style.maxHeight = (innerHeight - 8) / zoom + 'px';
    const rect = panel.getBoundingClientRect();
    panel.style.left = Math.max(4, Math.min(x, innerWidth - rect.width - 4)) / zoom + 'px';
    panel.style.top = Math.max(4, Math.min(y, innerHeight - rect.height - 4)) / zoom + 'px';
  }
  private keydown(event: KeyboardEvent): void {
    if (!this.panels.length) return;
    if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter','Escape','Tab','Home','End'].includes(event.key)) { this.dismiss(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { this.dismiss(); return; }
    const depth = this.active ? Number(this.active.dataset.depth) : 0, panel = this.panels[depth];
    const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    if (event.key === 'ArrowLeft') {
      if (depth) { const parent = this.panels[depth - 1].querySelector<HTMLButtonElement>('[aria-expanded="true"]'); this.closeAfter(depth - 1); if (parent) this.highlight(parent); } return;
    }
    if (event.key === 'ArrowRight' || event.key === 'Enter') {
      if (!this.active) return;
      const item = (this.active as any).__contextItem as Item;
      if (item.children) this.submenu(this.active, item, true); else if (event.key === 'Enter') void this.accept(item); return;
    }
    const index = buttons.indexOf(this.active!), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
      index < 0 ? event.key === 'ArrowUp' ? buttons.length - 1 : 0 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    this.closeAfter(depth); if (buttons[next]) { this.highlight(buttons[next]); buttons[next].scrollIntoView({ block: 'nearest' }); }
  }
}
