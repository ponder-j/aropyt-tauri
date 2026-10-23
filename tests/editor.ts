import { undo, redo } from '@codemirror/commands';
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DocEditor, setBlockRenderer, setSingleBlockRenderer } from '../src/renderer/editor';
import { blockRanges, renderDocument, setDialect, standaloneImage } from '../src/renderer/md';
import { documentStatistics } from '../src/shared/document-statistics';
import { transformImage } from '../src/renderer/image-actions';
import { rangeAction } from '../src/renderer/editing-commands';
import { displayFileUrl } from '../src/bridge/files';
import { tableText } from '../src/renderer/table-dom';

const runtimeErrors: string[] = [];
window.addEventListener('error', (event) => runtimeErrors.push(event.message));
window.addEventListener('unhandledrejection', (event) => runtimeErrors.push(String(event.reason)));
(window as any).editorErrors = () => runtimeErrors;

setBlockRenderer(blockRanges);
setSingleBlockRenderer((src) => renderDocument(src).html.match(/<div id="write"[^>]*>([\s\S]*)<\/div>\s*<\/div>/)?.[1] ?? '');
const parent = document.getElementById('md-editor')!;
const editor = new DocEditor({ parent, doc: '', host: {
  docDir: () => undefined, math: (s) => s, resolveSrc: (s) => s, enhance: () => {},
}, onChange: () => {} });
const view = editor.view;
// CodeMirror catches handler errors internally; include them in regression failures.
view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.exceptionSink.of(error => runtimeErrors.push(String(error)))) });
// WebKit suspends animation frames when the test window is occluded or the
// desktop is locked. Layout assertions still run against the real WebView.
const frame = () => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 100);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
});
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function cursor(pos: number) { view.dispatch({ selection: { anchor: pos } }); view.focus(); }
function key(key: string, extra = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
}
function insert(text: string) {
  const sel = view.state.selection.main;
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length }, userEvent: 'input' });
}
function click(selector: string) {
  const target = parent.querySelector(selector);
  assert(target, 'Missing click target: ' + selector);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
}

function cellSelection(cell: HTMLElement, from: number, to = from): void {
  cell.focus(); const nodes: Text[] = [], walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('[data-table-rendered]')) nodes.push(walker.currentNode as Text);
  const point = (offset: number): [Node, number] => {
    for (const node of nodes) { if (offset <= node.length) return [node, offset]; offset -= node.length; }
    return [cell, cell.childNodes.length];
  };
  const range = document.createRange(); range.setStart(...point(from)); range.setEnd(...point(to));
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange'));
}

(window as any).runEditorTests = async () => {
  await Promise.all(['16px "Open Sans"', 'bold 16px "Open Sans"', 'italic 16px "Open Sans"', 'bold italic 16px "Open Sans"'].map((font) => document.fonts.load(font)));
  await document.fonts.ready;
  const passed: string[] = [];
  async function test(name: string, run: () => void | Promise<void>) {
    (window as any).__currentEditorTest = name;
    editor.setSourceMode(false);
    editor.configure({});
    setDialect({ diagrams: true, fenceLineNumbers: false, strictMode: true, codeBlockMath: true,
      smartQuotes: false, smartDash: false, remapPunctuation: false, visibleBr: false });
    await run(); await frame(); passed.push(name);
  }
  await test('Statistics match the native mixed Markdown fixture, code, URLs and source character counts', () => {
    const sample = '# 统计 Heading\n\nHello **bold** world. 中文测试。\n\n`inline code`\n\n```java\nint count = 1;\n```\n\n[Link text](https://example.com)\n\n![Alt text](missing.png)\n';
    const actual = documentStatistics(sample);
    assert(actual.words === 23 && actual.characters === 145 && actual.lines === 14 && actual.minutes === 0, 'Statistics disagree with the native fixture');
    assert(documentStatistics('```java\nint count = 1;\n```\n').words === 4, 'Code or fence language was omitted');
    assert(documentStatistics('[Link text](https://example.com)\n').words === 4, 'Link destination word rules differ from the native result');
    assert(documentStatistics('![Alt text](missing.png)\n').words === 3, 'Image path and alternative text were omitted');
  });
  await test('Statistics use source lines and configurable rounded reading time', () => {
    assert(documentStatistics('word '.repeat(200)).minutes === 1, '200 words should round to one minute at the native 382 words per minute');
    assert(documentStatistics('word '.repeat(200), 100).minutes === 2, 'Reading speed was ignored');
    assert(documentStatistics('word '.repeat(200), 0).minutes === 1, 'Invalid reading speed should use the default');
    assert(documentStatistics('中文测试').words === 4, 'Chinese characters should count separately');
    assert(documentStatistics('one\r\ntwo\r\n').lines === 3 && documentStatistics('').lines === 1, 'Source line endings or empty document line count changed');
  });
  await test('Mixed inline images retain their size and neighboring rich text during native editing', async () => {
    const image = '![alt](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==)';
    const source = 'Before **bold** ' + image + ' after *italic*.';
    editor.setValue(source); cursor(1); await frame();
    let preview = parent.querySelector<HTMLElement>('.cm-inline-image')!;
    assert(preview && parent.querySelector('.cm-md-strong')?.textContent === 'bold', 'Mixed paragraph fell back to a whole-block widget');
    const img = preview.querySelector('img')!;
    assert(img.getBoundingClientRect().width <= 2, 'Intrinsic image was expanded to paragraph width');
    preview.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'alt', 'Image click did not select only its alt text');
    assert(parent.querySelector('.cm-inline-image-source') && parent.querySelector('.cm-inline-image img'), 'Active image lost its source or preview');
    insert('changed'); await frame(); cursor(1); await frame();
    assert(editor.value === source.replace('![alt]', '![changed]') && parent.querySelector('.cm-md-emphasis')?.textContent === 'italic', 'Image edit changed neighboring source');
    undo(view); assert(editor.value === source, 'Inline image edit cannot undo');
  });
  await test('Reference images resolve across the document and follow definition edits without rewriting source', async () => {
    const source = 'Before ![label][FIGURE] after.\n\n![standalone][figure]\n\n[figure]: first.png "Title"\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const previews = Array.from(parent.querySelectorAll<HTMLImageElement>('.cm-image-preview img'));
    assert(previews.length === 2 && previews.every(image => image.getAttribute('src') === 'first.png' && image.title === 'Title'), 'Reference image lost definition context');
    assert(parent.querySelector('.cm-reference-definition')?.textContent === '[figure]: first.png "Title"', 'Reference definition disappeared');
    const from = source.indexOf('first.png'); view.dispatch({ changes: { from, to: from + 9, insert: 'second.png' } }); await frame();
    assert(Array.from(parent.querySelectorAll('.cm-image-preview img')).every(image => image.getAttribute('src') === 'second.png'), 'Definition edit did not update previews');
    assert(editor.value.includes('![label][FIGURE]') && editor.value.includes('![standalone][figure]'), 'Reference syntax was rewritten');
    const preview = parent.querySelector<HTMLElement>('.cm-inline-image')!;
    assert(editor.imageAt(preview)?.source === '![label][FIGURE]', 'Inline reference image lost its contextual source range');
    assert(editor.handleImageAction('image:zoom:50'), 'Inline reference image missed its image command');
    assert(editor.value.includes('<img src="second.png"') && editor.value.includes('zoom:50%') && editor.value.includes('![standalone][figure]'), 'Image command affected another reference or lost its resolved path');
  });
  await test('Inline HTML image dimensions and broken-image source stay local to the image', async () => {
    const source = 'Before <img src="missing.png" width="120" height="60" alt="sample"> after **bold**.';
    editor.setValue(source); cursor(1); await frame();
    const image = parent.querySelector<HTMLImageElement>('.cm-inline-image img')!;
    assert(image?.style.width === '120px' && image.style.height === '60px', 'HTML inline image dimensions changed');
    image.dispatchEvent(new Event('error')); await frame();
    const fallback = parent.querySelector<HTMLElement>('.cm-inline-image .cm-image-fallback')!;
    assert(!fallback.hidden && fallback.textContent?.includes('<img'), 'Failed image lost editable source fallback');
    assert(parent.querySelector('.cm-md-strong')?.textContent === 'bold', 'Failed image removed neighboring format');
  });
  await test('Footnotes edit locally while neighboring formats and definitions retain native text', async () => {
    const source = 'Before **bold**[^note] after.\n\n[^note]: Footnote *body*.\n\nTail';
    editor.setValue(source); cursor(1); await frame();
    const note = parent.querySelector<HTMLElement>('.cm-inline-footnote')!;
    assert(note?.textContent === 'note' && parent.querySelector('.cm-md-strong')?.textContent === 'bold', 'Footnote forced whole-paragraph source');
    note.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    assert(view.state.selection.main.head === 1, 'Footnote right-click changed the existing selection');
    const backref = parent.querySelector<HTMLElement>('.cm-footnote-backref');
    assert(backref, 'Footnote definition lost its back-reference action');
    backref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    assert(view.state.selection.main.head === source.indexOf('[^note]'), 'Footnote back-reference missed its source reference');
    note.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'note', 'Footnote click selected surrounding text');
    const at = source.indexOf('Footnote'); cursor(at); insert('New '); await frame();
    assert(editor.value.includes('[^note]: New Footnote *body*.') && parent.querySelector('.cm-reference-definition .cm-md-emphasis')?.textContent === 'body', 'Definition edit lost structure or inline rendering');
    undo(view); assert(editor.value === source, 'Footnote definition edit cannot undo');
  });
  const footnoteTooltip = async (target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    for (let n = 0; n < 50; n++) {
      const tooltip = document.querySelector<HTMLElement>('.cm-footnote-tooltip');
      if (tooltip) return tooltip;
      // WebKit can deliver a pending layout scroll just after the first hover.
      // Re-enter after it settles; scrolling correctly dismisses the preview.
      if (n && n % 10 === 0) target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Footnote preview did not open');
  };
  await test('Paragraph and table footnote hover previews share rich definitions and never change the selection or source', async () => {
    const source = 'Before **bold**[^note] after.\n\n| A | B |\n| --- | --- |\n| same[^note] | other |\n\n[^note]: First *italic* **strong** and `code`, [reference][site] with ![alt][figure] and $x^2$.\n\n[site]: https://example.com/ "Title"\n[figure]: sample.svg\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const selected = view.state.selection.main.head;
    for (const selector of ['.cm-inline-footnote:not(.md-table-footnote)', '.md-table-footnote']) {
      const target = parent.querySelector<HTMLElement>(selector)!, tooltip = await footnoteTooltip(target);
      assert(tooltip.querySelector('em')?.textContent === 'italic' && tooltip.querySelector('strong')?.textContent === 'strong' && tooltip.querySelector('code')?.textContent === 'code', 'Footnote hover lost inline formatting');
      assert(tooltip.querySelector('a')?.getAttribute('href') === 'https://example.com/' && tooltip.querySelector('a')?.title === 'Title' && tooltip.querySelector('img')?.getAttribute('src') === 'sample.svg', 'Footnote preview lost whole-document reference definitions');
      assert(tooltip.querySelector('.md-inline-math')?.textContent === 'x^2' && !tooltip.querySelector('.footnote-backref,.footnotes-list'), 'Footnote preview omitted math or included export-only navigation');
      assert(Array.from(tooltip.querySelectorAll<HTMLElement>('a,[tabindex]')).every(node => node.tabIndex < 0), 'Passive preview added keyboard tab stops');
      assert(target.getAttribute('aria-describedby') === tooltip.id && view.state.selection.main.head === selected && editor.value === source, 'Hover stole the selection or changed Markdown');
      target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      assert(!document.querySelector('.cm-footnote-tooltip') && !target.hasAttribute('aria-describedby'), 'Leaving a reference retained its tooltip or accessibility link');
    }
  });
  await test('Open footnote previews refresh on definition edits and undo, then close when the definition disappears', async () => {
    const source = 'Before[^note] after.\n\n[^note]: Original *body*.\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const target = parent.querySelector<HTMLElement>('.cm-inline-footnote')!; await footnoteTooltip(target);
    const from = source.indexOf('Original'); view.dispatch({ changes: { from, to: from + 8, insert: 'Updated' }, userEvent: 'input' }); await frame();
    assert(document.querySelector('.cm-footnote-tooltip')?.textContent?.includes('Updated body'), 'Open preview showed stale definition content: ' + JSON.stringify({tooltip: document.querySelector('.cm-footnote-tooltip')?.textContent, reference: target.outerHTML, connected: target.isConnected, source: editor.value}));
    undo(view); await frame(); assert(document.querySelector('.cm-footnote-tooltip')?.textContent?.includes('Original body') && editor.value === source, 'Preview or source did not follow undo');
    const definition = editor.value.indexOf('[^note]:'); view.dispatch({ changes: { from: definition, to: definition + '[^note]: Original *body*.'.length, insert: '' } }); await frame();
    assert(!document.querySelector('.cm-footnote-tooltip'), 'Deleted definition retained an obsolete preview');
  });
  await test('Footnote hover is passive, closes on editing, Escape, scrolling and source mode, and ignores missing definitions', async () => {
    const source = 'Before[^note] and missing[^missing].\n\n[^note]: Body.\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const target = () => parent.querySelector<HTMLElement>('[data-footnote-label="note"]')!;
    await footnoteTooltip(target()); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(!document.querySelector('.cm-footnote-tooltip'), 'Escape outside the editor left the footnote preview open');
    await footnoteTooltip(target()); view.scrollDOM.dispatchEvent(new Event('scroll')); assert(!document.querySelector('.cm-footnote-tooltip'), 'Scrolling retained a detached preview');
    await footnoteTooltip(target()); target().dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    assert(!document.querySelector('.cm-footnote-tooltip') && editor.value === source, 'Right mouse down left the passive preview open or edited source');
    const missing = parent.querySelector<HTMLElement>('[data-footnote-label="missing"]')!;
    missing.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 260));
    assert(!document.querySelector('.cm-footnote-tooltip'), 'Missing definition produced an empty tooltip');
    missing.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    await footnoteTooltip(target()); editor.setSourceMode(true); await frame(); assert(!document.querySelector('.cm-footnote-tooltip'), 'Source mode retained a rich preview');
  });
  await test('Footnote preview isolates document metadata, keeps HTML passive and fits the viewport at application zoom', async () => {
    const source = '---\ntitle: Metadata stays outside the preview\n---\n\nBefore[^constructor].\n\n[^constructor]: Safe **body** <span id="duplicate" contenteditable autofocus tabindex="0">content</span> <img src="missing.svg" onerror="window.__footnoteExecuted=true"> <input autofocus> <script>window.__footnoteExecuted=true</script> ' + 'long text '.repeat(60) + '\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    document.body.style.zoom = '1.5';
    try {
      const target = parent.querySelector<HTMLElement>('.cm-inline-footnote')!, tooltip = await footnoteTooltip(target);
      assert(tooltip.textContent?.includes('Safe body') && !tooltip.textContent?.includes('Metadata stays'), 'Metadata leaked into the footnote preview');
      assert(!tooltip.querySelector('script,input,[onerror],[id],[contenteditable],[autofocus],[tabindex="0"]') && !(window as any).__footnoteExecuted, 'Hover activated inline HTML or duplicated document anchors');
      const rect = tooltip.getBoundingClientRect();
      assert(rect.left >= 7 && rect.right <= window.innerWidth - 7 && rect.top >= 7 && rect.bottom <= window.innerHeight - 7, 'Zoomed preview escaped the viewport: ' + JSON.stringify(rect));
      assert(editor.value === source, 'Passive HTML filtering changed saved Markdown');
    } finally { document.body.style.zoom = ''; key('Escape'); }
  });
  await test('Setext underlines apply to the last line in editor, outline and export', async () => {
    const source = 'First line\nSecond line\n-----------\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    assert(parent.querySelector('.cm-heading')?.textContent === 'Second line', 'Setext editor styled multiple lines as one heading');
    const output = renderDocument(source);
    assert(output.headings.length === 1 && output.headings[0].text === 'Second line' && output.headings[0].line === 1, 'Setext outline used the wrong range');
    assert(/<p>First line<\/p>/.test(output.html) && /<h2[^>]*>Second line<\/h2>/.test(output.html), 'Setext export differs from editor');
    assert(editor.value === source, 'Rendering changed the saved source');
  });
  await test('Media and footnote syntax inside code and TeX remains literal', async () => {
    const source = '`![alt](missing.png) [^note]`\n\n```md\n[figure]: missing.png\n[^note]: literal\n```\n\n$\\text{![alt](missing.png) [^note]}$\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    assert(!parent.querySelector('.cm-image-preview,.cm-inline-footnote,.cm-reference-definition'), 'Code syntax was interpreted as rich media or a definition');
    assert(editor.value === source, 'Code syntax changed');
  });
  await test('Table images edit only their source while neighboring formats, math and undo survive', async () => {
    const source = '| A | B |\n| --- | --- |\n| Before **bold** ![alt](sample.svg) after | $x^2$ |\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const cell = parent.querySelector<HTMLElement>('td[data-col="0"]')!;
    cellSelection(cell, 2); await frame();
    assert(cell.querySelector('.cm-md-strong')?.textContent === 'bold' && cell.querySelector('.md-table-image-preview img'), 'Focusing image cell exposed the entire source');
    cell.querySelector('.md-table-image-preview')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(window.getSelection()?.toString() === 'alt' && cell.querySelector('.md-table-image-preview img'), 'Table image click lost its alt selection or preview');
    const data = new DataTransfer(); data.setData('text/plain', 'new alt');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value === source.replace('![alt]', '![new alt]') && parent.querySelector('.md-table-math-preview'), 'Table image edit changed neighbors or included rendered labels');
    assert(editor.handleTableAction('undo'), 'Table image edit missed table undo'); await frame();
    assert(editor.value === source, 'Table image edit cannot undo');
  });
  await test('Table image commands map escaped cells precisely and preserve padding, dimensions and undo', async () => {
    const image = '![a\\|b](sample.svg "x\\|y")';
    const source = 'Before\n\n| A   | B |\n| :--- | ---: |\n| left \\| side<BR />Before **bold** ' + image + ' after   | untouched  |\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const other = parent.querySelector<HTMLElement>('td[data-col="1"]')!; cellSelection(other, 0, 3);
    const range = editor.imageAt(parent.querySelector<HTMLElement>('.md-table-image-preview img')!)!;
    assert(range?.from === source.indexOf(image) && range.rawSource === image && standaloneImage(range.source)?.alt === 'a|b', 'Escapes or line breaks shifted the image range');
    assert(window.getSelection()?.toString() === 'unt', 'Target detection changed another cell selection');
    editor.handleImageAction('image:markdown'); await frame();
    assert(editor.value === source, 'Unchanged image syntax rewrote its escaped source or table padding');
    editor.handleImageAction('image:zoom:50'); await frame();
    const updated = '<img src="sample.svg" alt="a&#124;b" title="x&#124;y" style="zoom:50%;" />';
    assert(editor.value === source.replace(image, updated), 'Zoom changed other cells, table layout or image pipe values: ' + editor.value);
    assert(['50%', '0.5'].includes(parent.querySelector<HTMLImageElement>('.md-table-image-preview img')?.style.zoom || '') && window.getSelection()?.toString() === updated, 'Zoom lost preview dimensions or source selection: ' + JSON.stringify({zoom: parent.querySelector<HTMLImageElement>('.md-table-image-preview img')?.style.zoom, selection: window.getSelection()?.toString(), active: document.activeElement?.outerHTML}));
    assert(document.activeElement?.matches('td[data-col="0"]'), 'Zoom did not focus its target cell');
    parent.querySelector<HTMLElement>('td[data-col="1"]')!.focus(); await frame();
    assert(editor.value === source.replace(image, updated), 'Leaving an unchanged image cell normalized its original line-break syntax or table padding');
    undo(view); await frame(); assert(editor.value === source, 'Table image command cannot undo exactly');
  });
  await test('Table reference images and fallback HTML cells retain exact image action targets', async () => {
    const source = '| A | B |\n| --- | --- |\n| ![one][figure] then ![two][figure] | other |\n| <span>Before</span> ![fallback](sample.svg) after | other |\n\n[figure]: sample.svg "Title"\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const previews = parent.querySelectorAll<HTMLElement>('td[data-row="1"] .md-table-image-preview');
    assert(previews.length === 2 && editor.imageAt(previews[1])?.source === '![two][figure]', 'Repeated references lost their separate targets');
    editor.handleImageAction('image:zoom:50'); await frame();
    assert(editor.value === source.replace('![two][figure]', '<img src="sample.svg" alt="two" title="Title" style="zoom:50%;" />'), 'Reference action changed another image or its shared definition');
    undo(view); await frame(); cursor(source.length); await frame();
    const fallback = parent.querySelector<HTMLElement>('td[data-row="2"] img')!;
    assert(fallback && editor.imageAt(fallback)?.source === '![fallback](sample.svg)', 'Rendered HTML fallback image lacks a precise source range');
    editor.handleImageAction('image:html'); await frame();
    assert(editor.value === source.replace('![fallback](sample.svg)', '<img src="sample.svg" alt="fallback" />'), 'Fallback image conversion damaged surrounding HTML');
  });
  await test('Removing a sole table image keeps an editable empty cell and stale file actions cannot overwrite newer text', async () => {
    const source = '| A | B |\n| --- | --- |\n|  ![alt](sample.svg)   | other |\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const range = editor.imageAt(parent.querySelector<HTMLElement>('.md-table-image-preview')!)!;
    assert(editor.replaceImage(range, '', true), 'Image removal was rejected'); await frame();
    assert(editor.value === source.replace('![alt](sample.svg)', '') && document.activeElement?.matches('td[data-col="0"]'), 'Image removal changed table spacing or lost its empty cell focus');
    undo(view); await frame(); assert(editor.value === source, 'Image removal cannot undo');
    const old = editor.imageAt(parent.querySelector<HTMLElement>('.md-table-image-preview')!)!;
    view.dispatch({ changes: { from: 0, insert: 'Before\n\n' } }); await frame();
    assert(!editor.replaceImage(old, '![alt](copied.svg)') && editor.value === 'Before\n\n' + source, 'A delayed image action overwrote newer content');
  });
  await test('Table footnotes edit locally, keep neighboring media and return from definitions to the native cell caret', async () => {
    const source = '| A | B |\n| --- | --- |\n| Before **bold**[^note] after | ![alt][figure] and [^second] |\n| `[^literal]` $\\text{[^math]}$ | other |\n\n[^note]: Footnote *body*.\n\n[^second]: Second.\n\n[figure]: sample.svg\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const cell = parent.querySelector<HTMLElement>('td[data-row="1"][data-col="0"]')!; cellSelection(cell, 2); await frame();
    assert(cell.querySelector('.cm-md-strong')?.textContent === 'bold' && cell.querySelector('sup.md-table-footnote')?.textContent === 'note', 'Footnote cell exposed neighboring source on focus');
    assert(parent.querySelectorAll('.md-table-footnote').length === 2 && parent.querySelector('.md-table-image-preview'), 'Footnotes in code/TeX were interpreted, or a neighboring reference image was lost');
    cell.querySelector('.md-table-footnote')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(window.getSelection()?.toString() === 'note' && cell.querySelector('.cm-md-strong')?.textContent === 'bold', 'Footnote click failed to select only its local label');
    const data = new DataTransfer(); data.setData('text/plain', 'renamed');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value === source.replace('**bold**[^note]', '**bold**[^renamed]'), 'Footnote label edit changed definitions or neighboring cells');
    undo(view); await frame(); assert(editor.value === source, 'Table footnote edit cannot undo');
    cursor(source.length); await frame(); parent.querySelector<HTMLElement>('.cm-footnote-backref')!.click(); await frame();
    assert(document.activeElement?.matches('td[data-row="1"][data-col="0"]') && cell.querySelector('.cm-md-marker')?.textContent?.includes('[^'), 'Footnote return did not focus its editable table reference');
    assert(editor.value === source, 'Footnote return changed source');
  });
  await test('Native automatic replacements cannot rewrite table image attributes, code or TeX', async () => {
    const source = '| A | B |\n| --- | --- |\n| <img src="sample.svg"> | `say "hello"` |\n| $\\text{"x"}$ | plain "text" |\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const replacement = async (row: number, col: number, needle: string, inputType = 'insertReplacementText') => {
      const cell = parent.querySelector<HTMLElement>(`td[data-row="${row}"][data-col="${col}"]`)!;
      const at = tableText(cell).indexOf(needle); cellSelection(cell, at, at + 1); await frame();
      const range = window.getSelection()!.getRangeAt(0).cloneRange();
      const event = new InputEvent('beforeinput', { inputType, data: '“', bubbles: true, cancelable: true });
      Object.defineProperty(event, 'getTargetRanges', { value: () => [range] }); cell.dispatchEvent(event); return event.defaultPrevented;
    };
    assert(await replacement(1, 0, '"'), 'Native smart quotes could rewrite an HTML image attribute');
    assert(await replacement(1, 1, '"'), 'Native replacement could rewrite inline code');
    assert(await replacement(2, 0, '"'), 'Native replacement could rewrite TeX');
    assert(!await replacement(2, 1, '"'), 'Plain table text lost native correction');
    assert(!await replacement(1, 0, '"', 'insertCompositionText'), 'Source protection blocked IME composition');
    assert(editor.value === source, 'Source protection changed document contents');
  });
  await test('Table reference images follow document definitions and HTML dimensions remain intact', async () => {
    const source = '| A | B |\n| --- | --- |\n| ![ref][figure] | <img src="sized.svg" width="60" height="30"> |\n\n[figure]: first.svg\n\nTail';
    editor.setValue(source); cursor(source.length); await frame();
    const image = () => parent.querySelector<HTMLImageElement>('td[data-col="0"] .md-table-image-preview img')!;
    assert(image()?.getAttribute('src') === 'first.svg', 'Table image lost document reference context');
    const sized = parent.querySelector<HTMLImageElement>('td[data-col="1"] .md-table-image-preview img')!;
    assert(sized?.style.width === '60px' && sized.style.height === '30px', 'Table HTML image lost dimensions');
    const at = editor.value.indexOf('first.svg'); view.dispatch({ changes: { from: at, to: at + 9, insert: 'second.svg' } }); await frame();
    assert(image()?.getAttribute('src') === 'second.svg' && editor.value.includes('![ref][figure]'), 'Table reference image did not refresh or rewrote source');
  });
  await test('Spelling skips code and links by default and respects the explicit preference', async () => {
    editor.setValue('Prose `mispellt` and [label](https://mispellt.example)\n\n```java\nmispellt\n```'); cursor(2); await frame();
    assert(parent.querySelector<HTMLElement>('.cm-code-line')?.spellcheck === false, 'Code lines inherit prose checking');
    assert(parent.querySelector<HTMLElement>('.cm-md-code')?.spellcheck === false && parent.querySelector<HTMLElement>('.cm-md-link')?.spellcheck === false, 'Inline code or links inherit prose checking');
    editor.configure({spellcheckForCodeAndLink:true}); await frame();
    assert(parent.querySelector<HTMLElement>('.cm-code-line')?.spellcheck === true && parent.querySelector<HTMLElement>('.cm-md-code')?.spellcheck === true, 'Code spelling preference was ignored');
    editor.setValue('| Text | Code |\n| --- | --- |\n| prose | `mispellt` |'); cursor(0); await frame();
    editor.configure({spellcheckForCodeAndLink:false}); await frame();
    assert(parent.querySelector<HTMLElement>('td .cm-md-code')?.spellcheck === false, 'Table inline code bypassed the spelling preference');
    editor.configure({spellcheckForCodeAndLink:true}); await frame();
    assert(parent.querySelector<HTMLElement>('td .cm-md-code')?.spellcheck === true, 'Table spelling preference did not update');
  });
  await test('Enter creates paragraphs and Shift Enter preserves a single line break', async () => {
    editor.setValue('First paragraph.\n\nSecond paragraph.'); cursor('First paragraph.'.length);
    key('Enter'); insert('New paragraph.');
    assert(editor.value === 'First paragraph.\n\nNew paragraph.\n\nSecond paragraph.', 'Enter did not create a Markdown paragraph');
    cursor('First paragraph.'.length); key('Enter', { shiftKey: true }); insert('Soft line.');
    assert(editor.value.startsWith('First paragraph.\nSoft line.\n\n'), 'Shift Enter created a separate paragraph');
    undo(view); undo(view); assert(!editor.value.includes('Soft line.'), 'Soft line edit did not undo');
    editor.setSourceMode(true); editor.setValue('Source'); cursor(6); key('Enter'); insert('line');
    assert(editor.value === 'Source\nline', 'Source mode Enter should insert a physical newline');
  });
  await test('Paragraph splitting replaces selections and heading Enter preserves the title', () => {
    editor.setValue('First second'); cursor(6); key('Enter');
    assert(editor.value === 'First \n\nsecond', 'Mid-paragraph Enter did not split the paragraph');
    editor.setValue('First old second'); view.dispatch({ selection: { anchor: 6, head: 10 } }); key('Enter');
    assert(editor.value === 'First \n\nsecond', 'Paragraph split failed to replace the selection');
    editor.setValue('## Heading\n\nAfter'); cursor(10); key('Enter'); insert('New paragraph');
    assert(editor.value === '## Heading\n\nNew paragraph\n\nAfter', 'Heading Enter did not create body text');
    editor.setValue('After'); cursor(5); key('Enter'); key('Enter'); insert('Last');
    assert(editor.value === 'After\n\n\n\nLast', 'Repeated Enter did not retain an empty paragraph');
  });
  await test('Backspace and forward Delete merge paragraphs while preserving soft breaks and undo', async () => {
    const source = 'First paragraph.\n\nSecond paragraph.';
    editor.setValue(source); cursor(source.indexOf('Second')); key('Backspace');
    assert(editor.value === 'First paragraph.Second paragraph.', 'Paragraph-start Backspace only removed half the separator');
    undo(view); assert(editor.value === source, 'Paragraph merge cannot undo');
    cursor('First paragraph.'.length); key('Delete');
    assert(editor.value === 'First paragraph.Second paragraph.', 'Paragraph-end Delete only removed half the separator');
    editor.setValue('First\nSoft'); cursor(6); key('Backspace'); assert(editor.value === 'FirstSoft', 'Soft break Backspace changed paragraph semantics');
    editor.setValue('First\n\n\n\nLast'); cursor(editor.value.length); await frame();
    const blank = Array.from(parent.querySelectorAll<HTMLElement>('.cm-line')).filter((line) => !line.textContent?.trim());
    assert(blank.length >= 1, 'Intentional empty paragraphs were hidden like separating blank lines');
    editor.setValue('First\n\n'); cursor(editor.value.length); key('Backspace'); assert(editor.value === 'First', 'Backspace from a new empty paragraph failed to merge it');
  });
  await test('Loading a document clears the previous file undo and redo while new edits remain reversible', () => {
    editor.loadDocument('Document A'); cursor(editor.value.length);
    insert(' first'); insert(' second');
    assert(undo(view) && editor.value === 'Document A first', 'Document A edit did not undo');
    assert(redo(view) && editor.value === 'Document A first second', 'Document A edit did not redo');
    assert(undo(view) && editor.value === 'Document A first', 'Could not prepare both history branches before switching');
    editor.loadDocument('Document B');
    assert(view.state.selection.main.empty && view.state.selection.main.head === 0, 'Loaded document did not start at the beginning');
    assert(!undo(view) && !redo(view) && editor.value === 'Document B', 'Previous document history leaked into the loaded file');
    cursor(editor.value.length); insert(' edited');
    assert(undo(view) && editor.value === 'Document B', 'New document input did not undo in one step');
    assert(!undo(view) && editor.value === 'Document B', 'Undo crossed the loaded document boundary');
    assert(redo(view) && editor.value === 'Document B edited', 'New document input did not redo in one step');
    assert(!redo(view), 'Previous document redo survived the document switch');
    editor.loadDocument('');
    assert(!undo(view) && !redo(view) && editor.value === '', 'Loading a new empty document retained history');
    insert('New document');
    assert(undo(view) && editor.value === '', 'First edit in a new empty document did not undo');
    assert(redo(view) && editor.value === 'New document', 'First edit in a new empty document did not redo');
  });
  await test('Loading preserves editor modes and preferences while setValue remains an undoable edit', () => {
    editor.configure({ indentSize: '3', codeIndentSize: 2, fenceAutoWrap: false, spellCheck: false });
    editor.setSourceMode(true); editor.setFocusMode(true); editor.setTypewriterMode(true);
    try {
      editor.loadDocument('Source document');
      assert(editor.isSourceMode && ['mode-source', 'mode-focus', 'mode-typewriter', 'no-code-wrap'].every((name) => view.dom.classList.contains(name)), 'Loading changed editor modes or code wrapping preference');
      assert(view.contentDOM.getAttribute('spellcheck') === 'false' && view.dom.style.getPropertyValue('--code-tab-size') === '2', 'Loading discarded editor preferences');
      key('Tab');
      assert(editor.value === '   Source document', 'Loading discarded the configured prose Tab size');
      assert(undo(view) && editor.value === 'Source document', 'Preserved preferences broke new document undo');
      editor.setValue('Replacement');
      assert(undo(view) && editor.value === 'Source document', 'setValue no longer behaves as an undoable edit');
      assert(redo(view) && editor.value === 'Replacement', 'setValue replacement no longer redoes');
    } finally {
      editor.setSourceMode(false); editor.setFocusMode(false); editor.setTypewriterMode(false);
    }
  });
  await test('Selecting across paragraphs does not reveal the hidden separator rows', async () => {
    editor.setValue('# Heading\n\nFirst paragraph.\n\nSecond paragraph.\n\nLast paragraph.'); cursor(editor.value.length); await frame();
    const positions = () => Array.from(parent.querySelectorAll<HTMLElement>('.cm-heading,.cm-paragraph-first')).map((node) => node.getBoundingClientRect().top);
    const before = positions(); editor.selectAll(); await frame();
    assert(positions().every((top, i) => Math.abs(top - before[i]) < .5), 'Selecting the document changed paragraph layout');
  });
  await test('List soft breaks retain the item and Enter continues the next item', async () => {
    editor.setValue('- List item'); cursor(editor.value.length); key('Enter', { shiftKey: true }); insert('Continuation'); await frame();
    assert(editor.value === '- List item\n  Continuation', 'List soft break lost Markdown continuation indentation');
    assert(parent.querySelectorAll('.cm-native-list').length === 2 && parent.querySelectorAll('.cm-list-bullet').length === 1, 'A soft line unfolded the list or gained another bullet');
    key('Enter'); insert('Next');
    assert(editor.value === '- List item\n  Continuation\n- Next', 'Enter from a soft line did not continue the list');
    editor.setValue('```java\n  code\n```'); cursor(editor.value.indexOf('code') + 4); key('Enter', { shiftKey: true }); insert('next');
    assert(editor.value.includes('  code\n  next'), 'Shift Enter inside code lost indentation');
  });
  await test('List Tab moves the item from inside its text, preserves the caret and undoes as one step', () => {
    const source = '- parent\n- child';
    editor.setValue(source); cursor(source.indexOf('child') + 2);
    key('Tab');
    assert(editor.value === '- parent\n  - child' && view.state.selection.main.head === source.indexOf('child') + 4, 'Tab inserted whitespace into the item text or lost the caret');
    undo(view); assert(editor.value === source, 'List indentation did not undo as one step');
    redo(view); key('Tab', { shiftKey: true }); assert(editor.value === source, 'Shift Tab did not restore the parent level');
    editor.setValue('- first'); cursor(editor.value.length); key('Tab');
    assert(editor.value === '- first\t', 'The first item without a preceding sibling did not retain native literal Tab behavior');
    editor.configure({ codeIndentSize: 2 }); editor.setValue('```text\nabc\n```'); cursor(editor.value.indexOf('abc') + 1); key('Tab');
    assert(editor.value.includes('a  bc'), 'List indentation changed code Tab preferences');
    editor.setSourceMode(true); editor.configure({ indentSize: 4 }); editor.setValue(source); cursor(source.indexOf('child') + 2); key('Tab');
    assert(editor.value === '- parent\n- ch    ild', 'Source mode unexpectedly used live list indentation');
  });
  await test('List indentation retains descendants, existing spacing, reverse selections and an excluded boundary row', () => {
    const source = '- parent\n- branch\n  - leaf\n- sibling';
    editor.setValue(source);
    view.dispatch({ selection: { anchor: source.indexOf('- sibling'), head: source.indexOf('branch') } });
    key('Tab');
    assert(editor.value === '- parent\n  - branch\n    - leaf\n- sibling', 'Indentation omitted descendants or included the next unselected item');
    assert(view.state.selection.main.anchor > view.state.selection.main.head, 'Indentation reversed a backward selection');
    undo(view); assert(editor.value === source, 'Multi-line indentation did not undo together');
    editor.setValue('- parent\n    - existing\n- next'); cursor(editor.value.length); key('Tab');
    assert(editor.value === '- parent\n    - existing\n    - next', 'Tab ignored existing sibling indentation');
    editor.setValue('- parent\n  - child\n    - leaf'); cursor(editor.value.indexOf('leaf')); key('Tab', { shiftKey: true });
    assert(editor.value === '- parent\n  - child\n  - leaf', 'Shift Tab removed more than one nesting level');
    editor.setSourceMode(true); editor.configure({ indentSize: 2 }); editor.setValue('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 0, head: 8 } }); key('Tab');
    assert(editor.value === '  one\n  two\nthree', 'A selection ending at the next line start indented that unselected line');
  });
  await test('Empty list and quote Enter creates a real paragraph at the remaining parent level', async () => {
    for (const [source, expected] of [
      ['- item', '- item\n\nNEXT'], ['9. item', '9. item\n\nNEXT'],
      ['- [x] done', '- [x] done\n\nNEXT'], ['> item', '> item\n\nNEXT'],
      ['- parent\n  - child', '- parent\n  - child\n  \n  NEXT'],
      ['> > item', '> > item\n>\n> NEXT'],
    ]) {
      editor.setValue(source); cursor(editor.value.length); key('Enter');
      const emptyItem = editor.value;
      key('Enter'); const paragraph = editor.value;
      undo(view); assert(editor.value === emptyItem, 'Exiting an empty item could not undo separately');
      redo(view); assert(editor.value === paragraph, 'Redo lost the empty-item exit');
      insert('NEXT'); await frame();
      assert(editor.value === expected, 'Empty item lost the paragraph boundary or parent level: ' + JSON.stringify(editor.value));
      assert(!parent.querySelector('.md-block-widget'), 'Parent continuation fell back to a whole-block source widget');
    }
  });
  await test('Enter replaces forward and backward text selections with a list item or quote row', async () => {
    const cases = [
      ['- alpha BETA omega\n- next', '- alpha \n-  omega\n- next'],
      ['  - alpha BETA omega', '  - alpha \n  -  omega'],
      ['9) alpha BETA omega', '9) alpha \n10)  omega'],
      ['- [x] alpha BETA omega', '- [x] alpha \n- [ ]  omega'],
      ['> > alpha BETA omega', '> > alpha \n> >  omega'],
    ];
    for (const [source, expected] of cases) for (const reverse of [false, true]) {
      editor.setValue(source); const from = source.indexOf('BETA'), to = from + 4;
      view.dispatch({ selection: { anchor: reverse ? to : from, head: reverse ? from : to } }); key('Enter');
      assert(editor.value === expected, 'Selected text Enter lost its structural prefix: ' + source);
      const head = view.state.selection.main.head;
      const body = editor.value.indexOf('omega');
      assert(view.state.selection.main.empty && head <= body && !editor.value.slice(head, body).trim(), 'Enter left the caret in the marker or on the previous item');
      undo(view); assert(editor.value === source, 'Selection split did not undo in one step');
      redo(view); assert(editor.value === expected, 'Selection split did not redo in one step');
    }
    editor.setValue('- alpha BETA omega'); view.dispatch({ selection: { anchor: 8, head: 12 } }); key('Enter', { shiftKey: true });
    assert(editor.value === '- alpha \n   omega', 'Selected Shift Enter did not retain a soft list continuation');
    await frame();
  });
  await test('List Enter preserves tab separators, task reset and repeated-number preferences', () => {
    for (const [source, expected] of [
      ['-\talpha', '-\talpha\n-\t'],
      ['1)\talpha', '1)\talpha\n2)\t'],
      ['-\t[x]\talpha', '-\t[x]\talpha\n-\t[ ]\t'],
      ['1. [x] alpha', '1. [x] alpha\n2. [ ] '],
    ]) {
      editor.setValue(source); cursor(source.length); key('Enter');
      assert(editor.value === expected, 'List Enter changed the original whitespace or lost the list: ' + source);
      undo(view); assert(editor.value === source, 'Tab-separated list split did not undo');
    }
    editor.configure({ orderedDelimiter: 'repeat' }); editor.setValue('3)\talpha BETA omega');
    const from = editor.value.indexOf('BETA'); view.dispatch({ selection: { anchor: from, head: from + 4 } }); key('Enter');
    assert(editor.value === '3)\talpha \n3)\t omega', 'Selection split ignored the repeated-number preference');
  });
  await test('List-start Backspace joins the preceding sibling or parent without losing indentation', async () => {
    for (const [source, expected] of [
      ['- parent\n- child\n- next', '- parent\n\n  child\n\n- next'],
      ['- parent\n  - child\n- next', '- parent\n  \n  child\n- next'],
      ['- parent\n  - first\n  - child\n    - grand\n  - sibling\n- next', '- parent\n  - first\n  \n    child\n    - grand\n  \n  - sibling\n- next'],
      ['10. parent\n11. child\n12. next', '10. parent\n\n    child\n\n12. next'],
      ['- [x] parent\n- [ ] child\n- next', '- [x] parent\n\n  child\n\n- next'],
      ['-\tparent\n-\tchild\n-\tnext', '-\tparent\n\n \tchild\n\n-\tnext'],
    ]) {
      editor.setValue(source); cursor(source.indexOf('child')); key('Backspace');
      assert(editor.value === expected, 'List marker removal lost the paragraph owner: ' + JSON.stringify(editor.value));
      assert(view.state.selection.main.head === expected.indexOf('child'), 'List marker removal moved the caret away from its body');
      await frame(); assert(!parent.querySelector('.md-block-widget'), 'Removing a simple list marker unfolded the entire block');
      undo(view); assert(editor.value === source, 'List paragraph join did not undo in one step');
      redo(view); assert(editor.value === expected, 'List paragraph join did not redo');
    }
  });
  await test('Removing the first list marker promotes its own children and preserves later siblings', async () => {
    for (const [source, expected] of [
      ['- child\n- next', 'child\n\n- next'],
      ['- child\n  - grand\n- next', 'child\n- grand\n\n- next'],
      ['- child\n  continuation\n  - grand\n    deeper\n- next', 'child\ncontinuation\n- grand\n  deeper\n\n- next'],
    ]) {
      editor.setValue(source); cursor(source.indexOf('child')); key('Backspace');
      assert(editor.value === expected, 'First-item marker removal retained stale indentation or changed a later sibling: ' + JSON.stringify(editor.value));
      await frame(); assert(!parent.querySelector('.md-block-widget'), 'Promoted children fell back to a source block');
      undo(view); assert(editor.value === source, 'First-item marker removal did not undo');
    }
    editor.setValue('- parent\n- child'); editor.setSourceMode(true); cursor(editor.value.indexOf('child')); key('Backspace');
    assert(editor.value === '- parent\n-child', 'Live list marker handling changed source-mode Backspace');
  });
  await test('Backspace at a nested quote start removes one level and keeps text and undo intact', () => {
    const source = '> > item\n\nAfter';
    editor.setValue(source); cursor(source.indexOf('item')); key('Backspace');
    assert(editor.value === '> item\n\nAfter' && view.state.selection.main.head === 2, 'Nested quote Backspace deleted text or more than one quote level');
    undo(view); assert(editor.value === source, 'Quote outdent could not undo');
    redo(view); key('Backspace'); assert(editor.value === 'item\n\nAfter', 'Second quote Backspace did not remove the remaining level');
  });
  await test('A Markdown table header followed by Enter becomes a focused editable table', async () => {
    editor.setValue('Before\n\n| Name \\| alias | Count |'); cursor(editor.value.length); key('Enter'); await frame();
    const cell = parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]');
    assert(parent.querySelectorAll('th').length === 2 && cell && document.activeElement === cell, 'Header Enter did not create/focus a two-column table');
    assert(editor.value.includes('| Name \\| alias | Count |\n| --- | --- |\n|  |  |'), 'Auto table creation lost the escaped pipe or empty body row');
    undo(view); assert(editor.value === 'Before\n\n| Name \\| alias | Count |', 'Table creation did not undo');
  });
  await test('Code remains editable and arrows move between body lines', async () => {
    editor.setValue('Before\n\n```java\npublic class Demo {\n  int value = 1;\n}\n```\n\nAfter');
    cursor(editor.value.indexOf('public'));
    await frame();
    assert(parent.querySelectorAll('.cm-code-line').length === 3, 'All code lines must stay editable');
    assert(!view.contentDOM.innerText.includes('```'), 'Fence markers leaked into live preview');
    const before = view.state.selection.main.head;
    const predicted = view.moveVertically(view.state.selection.main, true);
    key('ArrowDown'); await frame();
    assert(view.state.doc.lineAt(view.state.selection.main.head).text.includes('int value'), `ArrowDown skipped the code block (${before} -> ${view.state.selection.main.head}, predicted ${predicted.head})`);
    insert('X');
    assert(editor.value.includes('X'), 'Could not type inside code');
    undo(view); assert(!editor.value.includes('X'), 'Undo lost code edit');
    redo(view); assert(editor.value.includes('X'), 'Redo lost code edit');
    cursor(editor.value.length); await frame();
    assert(parent.querySelectorAll('.cm-code-line').length === 3, 'Code box disappeared after leaving it');
  });
  await test('Mermaid expands a code box with a persistent live preview, then collapses after leaving', async () => {
    editor.setValue('Before\n\n```mermaid\ngraph LR\n  A --> B\n  B --> C\n```\n\nAfter');
    assert(parent.querySelector('.md-diagram'), 'Inactive Mermaid should render a preview');
    click('.md-block-widget[data-kind="fence"]'); await frame();
    assert(parent.querySelector('.md-diagram-edit-preview .md-diagram'), 'Editing must retain a graph below the code');
    const preview = parent.querySelector('.md-diagram-edit-preview');
    assert(parent.querySelectorAll('.cm-code-line').length === 3, 'Mermaid source needs an editable box');
    key('ArrowDown'); await frame();
    assert(parent.querySelectorAll('.cm-code-line').length === 3, 'Mermaid collapsed between source lines');
    insert('Updated');
    assert(parent.querySelector('.md-diagram-edit-preview') === preview, 'Typing replaced the graph container');
    assert(parent.querySelector<HTMLElement>('.md-diagram-edit-preview .md-diagram')?.dataset.source?.includes('Updated'), 'Live preview did not receive edited source');
    cursor(editor.value.length); await frame();
    assert(!parent.querySelector('.md-diagram-edit-preview') && !parent.querySelector('.cm-code-line'), 'Code editor did not collapse after leaving Mermaid');
    assert(parent.querySelector('.md-diagram-pending')?.textContent?.includes('Updated'), 'Preview did not receive edited source');
  });
  await test('Empty fenced blocks acquire an editable blank body on click', async () => {
    editor.setValue('Before\n\n```java\n```\n\nAfter');
    click('.md-block-widget[data-kind="fence"]'); await frame();
    insert('hello');
    assert(editor.value.includes('```java\nhello\n```'), 'Empty code block wrote into its delimiters');
  });
  await test('Typing an opening fence allows a language and Enter closes it', async () => {
    editor.setValue('');
    for (const character of '```java') insert(character);
    assert(editor.value === '```java', 'Fence completed before the language was typed');
    key('Enter'); await frame();
    insert('int n = 1;');
    assert(editor.value === '```java\nint n = 1;\n```', 'Enter did not create a code body and closing fence');
  });
  await test('Code indentation, Markdown-looking content and block selection', async () => {
    editor.setValue('Before\n\n~~~~python\n  # comment\n  value = 1\n~~~~\n\nAfter');
    cursor(view.state.doc.lineAt(editor.value.indexOf('value')).to);
    key('Enter'); await frame();
    assert(view.state.doc.lineAt(view.state.selection.main.head).text === '  ', 'Enter lost indentation');
    assert(!parent.querySelector('.cm-heading'), 'Code was treated as a Markdown heading');
    key('a', { metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform) });
    assert(!view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to).includes('~~~~'), 'Select code included delimiters');
  });
  await test('Language changes preserve code and undo; source mode exposes delimiters', async () => {
    editor.setValue('Before\n\n```java lineno\nint value = 1;\n```\n\nAfter');
    cursor(editor.value.indexOf('int value'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.value = 'javascript'; input.dispatchEvent(new Event('change')); await frame();
    assert(editor.value.includes('```javascript lineno'), 'Language change lost fence options');
    undo(view); assert(editor.value.includes('```java lineno'), 'Language change cannot undo');
    editor.setSourceMode(true); await frame();
    assert(view.contentDOM.innerText.includes('```java'), 'Source mode hides delimiters');
    editor.setSourceMode(false); await frame();
    assert(!view.contentDOM.innerText.includes('```java'), 'Source mode did not restore code box');
  });
  await test('Arrow and deletion boundaries preserve both delimiters', async () => {
    editor.setValue('```java\nhello\n```'); cursor(editor.value.indexOf('hello'));
    key('Backspace'); assert(editor.value.startsWith('```java\n'), 'Backspace removed opening fence');
    cursor(editor.value.indexOf('hello') + 5);
    key('Delete'); assert(editor.value.endsWith('\n```'), 'Delete removed closing fence');
    key('ArrowRight');
    assert(view.state.selection.main.head > editor.value.lastIndexOf('```') + 3, 'Cannot exit code at end of document');
    insert('After'); assert(editor.value.endsWith('\n\nAfter'), 'Text after code entered its closing fence');
  });
  await test('Unclosed fences and longer delimiters stay editable', async () => {
    editor.setValue('Before\n\n````text\n```\n# literal\n````\n\nAfter');
    cursor(editor.value.indexOf('# literal'));
    assert(parent.querySelectorAll('.cm-code-line').length === 2, 'Long fence closed at a shorter delimiter');
    editor.setValue('Before\n\n~~~text\nfirst\nsecond'); cursor(editor.value.length);
    insert('!'); assert(editor.value.endsWith('second!'), 'Unclosed fence is not editable');
    assert(parent.querySelectorAll('.cm-code-line').length === 2, 'Unclosed fence body disappeared');
  });
  await test('Global line-number preference applies to native code', async () => {
    setDialect({ fenceLineNumbers: true });
    editor.setValue('Before\n\n```java\none\ntwo\n```\n\nAfter');
    assert(parent.querySelectorAll('.cm-code-numbered').length === 2, 'Line number preference ignored');
  });
  await test('Backspace removes an empty code box without trapping the caret', async () => {
    editor.setValue('```java\n\n```'); cursor(8);
    key('Backspace');
    assert(editor.value === '', 'Empty code box cannot be removed');
  });
  await test('Native Select All command selects code first, then the document', async () => {
    editor.setValue('Before\n\n```java\nint value = 1;\n```\n\nAfter');
    cursor(editor.value.indexOf('int value'));
    editor.selectAll();
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'int value = 1;', 'Menu Select All did not select the code body');
    editor.selectAll();
    assert(view.state.selection.main.from === 0 && view.state.selection.main.to === editor.value.length, 'Repeated Select All did not select the document');
  });
  await test('New ATX headings keep their source and paragraph size until the caret leaves, then stay rendered', async () => {
    for (let level = 1; level <= 6; level++) {
      editor.setValue('\n\nAfter'); cursor(0);
      const fontSize = getComputedStyle(view.contentDOM).fontSize;
      for (let n = 0; n < level; n++) insert('#');
      await frame();
      assert(!parent.querySelector('.cm-heading') && view.contentDOM.innerText.includes('#'.repeat(level)), 'Typing hashes immediately rendered a heading');
      assert(getComputedStyle(view.contentDOM.querySelector('.cm-line')!).fontWeight === getComputedStyle(view.contentDOM).fontWeight, 'A bare hash acquired heading weight before the space');
      insert(' '); insert('Title'); await frame();
      const draft = view.contentDOM.querySelector<HTMLElement>('.cm-line')!;
      assert(draft.textContent === '#'.repeat(level) + ' Title' && getComputedStyle(draft).fontSize === fontSize, 'Draft heading hid its prefix or used heading size');
      const reference = document.createElement('h' + level); parent.append(reference);
      assert(getComputedStyle(draft).fontWeight === getComputedStyle(reference).fontWeight, 'Draft heading lost the theme heading weight while keeping paragraph size');
      reference.remove();
      assert(draft.querySelector('.cm-md-marker')?.textContent === '#'.repeat(level) + ' ', 'Draft heading prefix did not become a muted marker');
      cursor(level); key('ArrowLeft');
      assert(view.state.selection.main.head === level - 1, 'Draft heading prefix trapped the caret');
      cursor(editor.value.indexOf('Title') + 2); insert('x'); await frame();
      assert(!parent.querySelector('.cm-heading'), 'Editing within the draft committed the heading');
      cursor(editor.value.length); await frame();
      assert(parent.querySelector('.cm-header-' + level)?.textContent === 'Tixtle', 'Leaving the draft did not render its heading');
      cursor(0); await frame();
      assert(view.state.selection.main.head === level + 1 && !view.contentDOM.innerText.includes('#'), 'Returning to a committed heading reopened its prefix');
    }
  });
  await test('Draft heading Backspace edits visible markers and Enter commits the title', async () => {
    editor.setValue(''); cursor(0); insert('##'); insert(' '); insert('Title');
    cursor(3); key('Backspace');
    assert(editor.value === '##Title', 'Draft Backspace removed the whole heading prefix');
    cursor(2); insert(' '); cursor(2); key('Backspace');
    assert(editor.value === '# Title', 'Draft Backspace could not change the heading level');
    cursor(2); key('Backspace'); insert(' '); await frame();
    assert(!parent.querySelector('.cm-heading') && view.contentDOM.innerText.includes('# Title'), 'Repairing the draft heading space committed it');
    cursor(editor.value.length); key('Enter'); insert('Body'); await frame();
    assert(editor.value === '# Title\n\nBody' && parent.querySelector('.cm-header-1')?.textContent === 'Title', 'Enter did not commit the draft and create a paragraph');
    cursor(2); await frame();
    assert(!view.contentDOM.innerText.includes('#'), 'Enter-committed heading reopened on return');
    editor.setValue(''); cursor(0); insert('#######'); key('Backspace'); insert(' Title'); await frame();
    assert(!parent.querySelector('.cm-heading') && view.contentDOM.innerText.includes('###### Title'), 'Deleting a seventh hash prematurely rendered the draft');
    cursor(0); key('Enter'); await frame();
    assert(parent.querySelector('.cm-header-6')?.textContent === 'Title', 'Leaving the draft from its start did not commit it');
  });
  await test('Leaving a draft heading through editor blur or a cross-line selection commits it', async () => {
    editor.setValue(''); cursor(0); insert('#'); insert(' Title');
    view.contentDOM.blur(); await frame();
    assert(parent.querySelector('.cm-header-1')?.textContent === 'Title', 'Blurring the editor did not commit a single-line draft');
    view.focus(); await frame();
    assert(!view.contentDOM.innerText.includes('#'), 'Refocusing reopened the committed heading');
    editor.setValue('\n\nAfter'); cursor(0); insert('## Title');
    view.dispatch({ selection: { anchor: 3, head: editor.value.length } }); await frame();
    assert(parent.querySelector('.cm-header-2')?.textContent === 'Title', 'Selecting into another line left the draft uncommitted');
    cursor(3); await frame();
    assert(!view.contentDOM.innerText.includes('##'), 'Returning after a cross-line selection reopened the prefix');
  });
  await test('Document replacement, paste and source modes do not inherit draft heading state', async () => {
    editor.setValue(''); cursor(0); insert('# Draft');
    editor.setValue('## Loaded'); await frame();
    assert(parent.querySelector('.cm-header-2')?.textContent === 'Loaded', 'Document replacement inherited draft state at the same offset');
    editor.setValue(''); cursor(0);
    view.dispatch({ changes: { from: 0, insert: '# Pasted' }, selection: { anchor: 8 }, userEvent: 'input.paste' }); await frame();
    assert(parent.querySelector('.cm-header-1')?.textContent === 'Pasted', 'Pasted Markdown became an unfinished typed heading');
    editor.setValue(''); cursor(0); insert('# Draft'); editor.setSourceMode(true); await frame();
    assert(view.contentDOM.innerText.includes('# Draft'), 'Source mode lost the heading source');
    editor.setSourceMode(false); await frame();
    assert(parent.querySelector('.cm-header-1')?.textContent === 'Draft', 'Source mode round trip retained a stale draft');
    editor.setValue(''); cursor(0); insert('# Draft'); editor.loadDocument('# Loaded'); await frame();
    assert(parent.querySelector('.cm-header-1')?.textContent === 'Loaded', 'Loading a file inherited draft state');
  });
  await test('Draft heading recognition follows the Markdown dialect and leaves code as code', async () => {
    for (const strictMode of [true, false]) {
      setDialect({ strictMode });
      editor.setValue('\n\nAfter'); cursor(0); insert('#'); insert('Title'); await frame();
      assert(!parent.querySelector('.cm-heading') && view.contentDOM.innerText.includes('#Title'), 'Unfinished heading rendered while typing');
      cursor(editor.value.length); await frame();
      assert(!!parent.querySelector('.cm-header-1') === !strictMode, 'Committing the draft ignored strict heading syntax');
    }
    editor.setValue('```text\n\n```'); cursor(8); insert('# Code'); await frame();
    assert(!parent.querySelector('.cm-heading') && parent.querySelector('.cm-code-line')?.textContent === '# Code', 'Heading draft handling escaped its code fence');
  });
  await test('Hiding a separator does not swallow active heading styling', async () => {
    editor.setValue('Before\n\n## Heading\n\nAfter');
    cursor(editor.value.indexOf('## Heading'));
    await frame();
    const heading = parent.querySelector<HTMLElement>('.cm-header-2');
    assert(heading, 'The preceding hidden blank line swallowed the heading decoration');
    assert(parseFloat(getComputedStyle(heading).fontSize) > parseFloat(getComputedStyle(view.contentDOM).fontSize), 'Active heading lost its heading size');
  });
  await test('Headings hide markers and keep identical geometry while editing', async () => {
    editor.setValue('Before\n\n## Stable heading\n\n```java\nint n = 1;\n```\n\nAfter');
    const start = editor.value.indexOf('Stable heading');
    cursor(start + 4); await frame();
    const heading = parent.querySelector<HTMLElement>('.cm-header-2')!;
    const before = heading.getBoundingClientRect();
    const codeTop = parent.querySelector('.cm-code-top')!.getBoundingClientRect().top;
    cursor(editor.value.indexOf('int n')); await frame();
    const after = heading.getBoundingClientRect();
    assert(Math.abs(before.top - after.top) < 0.5 && Math.abs(before.height - after.height) < 0.5, 'Heading moved when caret left it');
    assert(Math.abs(codeTop - parent.querySelector('.cm-code-top')!.getBoundingClientRect().top) < 0.5, 'Content below heading jumped');
    assert(!view.contentDOM.innerText.includes('##'), 'Heading exposed its Markdown prefix');
    cursor(start); key('ArrowLeft');
    assert(view.state.selection.main.head < editor.value.indexOf('##'), 'Left arrow got trapped in hidden heading prefix');
  });
  await test('Heading theme survives native focus attribute updates', async () => {
    editor.setValue('# Main heading\n\n## Second heading\n\n```java\nint n = 1;\n```');
    cursor(editor.value.indexOf('Second heading'));
    view.contentDOM.blur(); await frame();
    const heading = parent.querySelector<HTMLElement>('.cm-header-2')!;
    const before = heading.getBoundingClientRect();
    view.focus(); await frame();
    const after = heading.getBoundingClientRect();
    assert(view.dom.classList.contains('aropyt-document-editor'), 'CodeMirror focus removed the heading theme scope');
    assert(Math.abs(before.top - after.top) < 0.5 && Math.abs(before.height - after.height) < 0.5, 'Heading shifted on focus');
    const reference = document.createElement('h2'); reference.textContent = 'Reference'; parent.append(reference);
    const expected = getComputedStyle(reference).fontSize; reference.remove();
    assert(getComputedStyle(heading).fontSize === expected, 'Focused heading fell back to a different font size');
  });
  await test('Backspace at heading start removes formatting; undo restores it', async () => {
    for (let level = 1; level <= 6; level++) {
      editor.setValue('#'.repeat(level) + ' Heading\n\nAfter');
      cursor(level + 1); key('Backspace');
      assert(editor.value.startsWith('Heading\n'), 'Heading Backspace did not remove the whole prefix');
      undo(view);
      assert(editor.value.startsWith('#'.repeat(level) + ' Heading'), 'Heading formatting did not undo');
      assert(!view.contentDOM.innerText.includes('#'), 'Undo exposed the restored prefix');
    }
  });
  await test('Heading body editing and source-mode markers remain editable', async () => {
    editor.setValue('## Heading\n\nAfter'); cursor(6); key('Backspace');
    assert(editor.value.startsWith('## Heding'), 'Body Backspace changed heading formatting');
    editor.setSourceMode(true); cursor(2); key('Backspace');
    assert(editor.value.startsWith('# Heding'), 'Source mode cannot edit heading markers');
  });
  await test('Setext headings keep their size and hidden underline during editing and undo', async () => {
    for (const underline of ['===', '---']) {
      editor.setValue('Before\n\nSetext heading\n' + underline + '\n\nAfter'); cursor(editor.value.length); await frame();
      const heading = parent.querySelector<HTMLElement>('.cm-heading')!;
      assert(heading, 'Setext heading fell back to a rendered block');
      const initial = heading.getBoundingClientRect();
      cursor(editor.value.indexOf('heading')); await frame();
      assert(heading.getBoundingClientRect().height === initial.height, 'Setext heading moved on focus');
      assert(!view.contentDOM.innerText.includes(underline), 'Setext delimiter leaked into the editor');
      cursor(editor.value.indexOf('Setext')); key('Backspace');
      assert(!editor.value.includes(underline) && editor.value.includes('Setext heading'), 'Setext Backspace did not remove formatting');
      undo(view); assert(editor.value.includes(underline), 'Setext formatting did not undo');
      cursor(view.state.doc.line(3).to); key('Enter'); insert('New paragraph');
      assert(editor.value.includes('Setext heading\n' + underline + '\n\nNew paragraph'), 'Setext Enter lost the heading or put text in its underline');
      undo(view); undo(view);
      cursor(view.state.doc.line(3).to); key('ArrowRight');
      assert(view.state.selection.main.head > editor.value.indexOf(underline) + underline.length, 'Right arrow got trapped in Setext underline');
      editor.setSourceMode(true); await frame(); assert(view.contentDOM.innerText.includes(underline), 'Source mode lost Setext underline');
      editor.setSourceMode(false);
    }
  });
  await test('Language combobox filters aliases and supports keyboard acceptance', async () => {
    editor.setValue('Before\n\n```java lineno\nint n = 1;\n```\n\nAfter'); cursor(editor.value.indexOf('int n'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus(); input.value = 'j'; input.dispatchEvent(new Event('input'));
    const labels = Array.from(document.querySelectorAll('.cm-language-option')).map((option) => option.textContent);
    assert(labels.includes('java') && labels.includes('javascript') && labels.includes('js'), 'Language suggestions are not real supported names/aliases');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(editor.value.includes('```javascript lineno'), 'Keyboard completion did not commit the selected language');
    assert(!document.querySelector('.cm-language-options'), 'Completed language popup leaked');
    assert(document.activeElement === input, 'Enter should keep focus in the language field');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert(document.activeElement === view.contentDOM, 'Tab should return to the code body');
    undo(view); assert(editor.value.includes('```java lineno'), 'Language completion cannot undo');
  });
  await test('Language suggestions support mouse selection and close on blur', async () => {
    editor.setValue('Before\n\n```text\nhello\n```\n\nAfter'); cursor(editor.value.indexOf('hello'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus(); input.value = 'py'; input.dispatchEvent(new Event('input'));
    const option = Array.from(document.querySelectorAll('.cm-language-option')).find((item) => item.textContent === 'python')!;
    assert(option, 'Python suggestion missing'); option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert(editor.value.includes('```python'), 'Mouse language selection did not commit');
    const next = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    next.focus(); next.blur(); assert(!document.querySelector('.cm-language-options'), 'Blur did not dismiss language popup');
  });
  await test('Language suggestions load the bundled coloured font and share icons across aliases', async () => {
    editor.setValue('```text\nhello\n```'); cursor(editor.value.indexOf('hello'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus(); input.value = 'j'; input.dispatchEvent(new Event('input'));
    const icon = (label: string) => Array.from(document.querySelectorAll('.cm-language-option'))
      .find((item) => item.textContent === label)?.querySelector<HTMLElement>('.cm-language-icon');
    assert(icon('java')?.classList.contains('ty-fi-java'), 'Java icon is not mapped');
    assert(icon('js')?.classList.contains('ty-fi-javascript'), 'JavaScript alias lost its icon');
    await document.fonts.load('12px ty-file');
    assert(document.fonts.check('12px ty-file'), 'Bundled file icon font did not load');
    assert(/[\ue000-\uf8ff]/.test(getComputedStyle(icon('java')!, '::before').content), 'Icon font has no glyph');
    input.value = 'py'; input.dispatchEvent(new Event('input'));
    assert(icon('python')?.querySelectorAll('span').length === 2, 'Python colour layers were not composed');
    input.blur();
  });
  await test('Diagram language shell stays inside preview and only its inner input gains a focus border', async () => {
    editor.setValue('Before\n\n```mermaid\ngraph LR\n A --> B\n```\n\nAfter'); cursor(editor.value.indexOf('graph'));
    await frame();
    const preview = parent.querySelector<HTMLElement>('.md-diagram-edit-preview')!;
    const shell = preview.querySelector<HTMLElement>('.cm-code-language-shell')!;
    const input = shell.querySelector<HTMLInputElement>('input')!;
    const outer = preview.getBoundingClientRect(), bounds = shell.getBoundingClientRect();
    assert(bounds.top > outer.top && bounds.right < outer.right && bounds.bottom < outer.bottom, 'Language shell crosses the preview border');
    assert(!parent.querySelector('.cm-code-bottom .cm-code-language'), 'Diagram has duplicate language controls');
    input.focus(); await frame();
    const inner = input.getBoundingClientRect();
    assert(inner.left > bounds.left + 10 && inner.right < bounds.right - 10 && inner.top > bounds.top && inner.bottom < bounds.bottom, 'Focus frame is not inset inside the gray shell');
    assert(shell.getBoundingClientRect().top === bounds.top && preview.getBoundingClientRect().height === outer.height, 'Focusing language changed preview geometry');
    input.value = 'mermaid'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(editor.value === 'Before\n\n```mermaid\ngraph LR\n A --> B\n```\n\nAfter', 'Diagram language editing damaged source');
  });
  await test('Code margins collapse with adjacent paragraphs like the rendered theme', async () => {
    const source = 'Before\n\n```text\nbody\n```\n\nAfter';
    editor.setValue(source); cursor(source.length); await frame();
    const reference = document.createElement('div'); reference.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;top:0;left:0;width:800px';
    reference.innerHTML = renderDocument(source).html; document.body.append(reference);
    const textTop = (node: Element) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().top; };
    const first = parent.querySelector<HTMLElement>('.cm-paragraph-first')!, last = Array.from(parent.querySelectorAll<HTMLElement>('.cm-paragraph-first')).at(-1)!;
    const cap = parent.querySelector('.cm-code-top .cm-code-cap')!.getBoundingClientRect(), bottom = parent.querySelector('.cm-code-bottom .cm-code-cap')!.getBoundingClientRect();
    const paragraphs = reference.querySelectorAll('#write > p'), code = reference.querySelector('#write > pre')!.getBoundingClientRect();
    const before = cap.top - textTop(first), expectedBefore = code.top - textTop(paragraphs[0]);
    const after = textTop(last) - bottom.bottom, expectedAfter = textTop(paragraphs[1]) - code.bottom;
    reference.remove();
    assert(Math.abs(before - expectedBefore) < 1 && Math.abs(after - expectedAfter) < 1, 'Code margins were added instead of collapsed: ' + JSON.stringify({ before, expectedBefore, after, expectedAfter }));
  });
  await test('Code footer and surrounding blocks keep their geometry on focus', async () => {
    editor.setValue('Before the code\n\n```java\nint n = 1;\n```\n\nAfter the code\n\n## Next heading\n\nLast paragraph');
    cursor(editor.value.indexOf('Before')); await frame();
    const measure = () => ['.cm-code-top', '.cm-code-bottom', '.cm-header-2'].map((selector) => {
      const rect = parent.querySelector(selector)!.getBoundingClientRect(); return [rect.top, rect.height];
    }).flat();
    const expected = measure();
    for (const position of [editor.value.indexOf('int n'), editor.value.indexOf('After'), editor.value.indexOf('int n')]) {
      cursor(position); await frame();
      assert(measure().every((value, i) => Math.abs(value - expected[i]) < 0.5), 'Code/heading moved when switching between code and paragraph');
    }
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus(); await frame();
    assert(measure().every((value, i) => Math.abs(value - expected[i]) < 0.5), 'Language field or popup pushed the document down');
    input.blur(); await frame();
    assert(measure().every((value, i) => Math.abs(value - expected[i]) < 0.5), 'Language field blur changed document geometry');
  });
  await test('Undo updates a focused language control and retiring it cannot write into the next document', async () => {
    editor.setValue('Before\n\n```text\nhello\n```\n\nAfter'); cursor(editor.value.indexOf('hello'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus(); input.value = 'java'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(document.activeElement === input, 'Language commit replaced its native input');
    undo(view); await frame();
    assert(input.value === 'text' && editor.value.includes('```text'), 'Undo left a stale language in the focused field');
    input.value = 'javascript'; input.dispatchEvent(new Event('change'));
    editor.setValue('A different document'); await frame();
    assert(editor.value === 'A different document', 'Retired language control overwrote the next document');
  });
  await test('Language input isolates editing and IME events from the document', async () => {
    editor.setValue('Before\n\n```text\nint n = 1;\n```\n\nAfter'); cursor(editor.value.indexOf('int n'));
    const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
    input.focus();
    let leaked = 0;
    const watch = () => leaked++;
    const events = ['beforeinput', 'input', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend'];
    events.forEach((type) => view.contentDOM.addEventListener(type, watch));
    input.value = 'java';
    for (const type of events) input.dispatchEvent(new Event(type, { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    assert(document.activeElement === input && editor.value.includes('```text\nint n'), 'IME confirmation left the language field or edited code');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(editor.value === 'Before\n\n```java\nint n = 1;\n```\n\nAfter', 'Language text appeared inside code');
    assert(leaked === 0, 'Language editing events escaped into CodeMirror');
    events.forEach((type) => view.contentDOM.removeEventListener(type, watch));
  });
  await test('Lists continue with incremented numbers and unchecked tasks, and exit when empty', () => {
    editor.configure({ orderedDelimiter: 'increment' });
    editor.setValue('9. ninth'); cursor(editor.value.length); key('Enter');
    assert(editor.value === '9. ninth\n10. ', 'Ordered continuation did not increment');
    assert(parent.querySelectorAll('.cm-native-list').length === 2, 'Empty new list item exposed whole-list source');
    key('Enter'); assert(editor.value === '9. ninth\n\n', 'Empty list item did not create a separate paragraph');
    editor.setValue('- [x] done'); cursor(editor.value.length); key('Enter');
    assert(editor.value === '- [x] done\n- [ ] ', 'Task continuation kept completed state');
    key('Backspace'); assert(editor.value === '- [x] done\n', 'Backspace did not remove empty task marker');
  });
  await test('Code highlighting follows the reference palette and Mermaid source is highlighted', async () => {
    editor.setValue('```java\npublic class Demo {\n int n = 1;\n}\n```'); cursor(editor.value.indexOf('public')); await frame();
    const colour = (selector: string) => getComputedStyle(parent.querySelector(selector)!).color;
    assert(colour('.hljs-keyword') === 'rgb(119, 0, 136)' && colour('.hljs-title') === 'rgb(0, 0, 255)', 'Code palette differs from the bundled CodeMirror reference');
    assert(colour('.hljs-type') === 'rgb(17, 102, 68)' && colour('.hljs-operator') === 'rgb(152, 26, 26)', 'Java primitive type/operator classification is missing');
    editor.setValue('```mermaid\ngraph LR\n A[Editing] --> B[Preview]\n```'); cursor(editor.value.indexOf('graph')); await frame();
    assert(parent.querySelector('.hljs-keyword')?.textContent === 'graph' && parent.querySelector('.hljs-type')?.textContent === '[Editing]', 'Mermaid code has no syntax highlighting');
  });
  await test('Code and prose use independent configurable Tab sizes', () => {
    editor.configure({ indentSize: '3', codeIndentSize: 2 });
    editor.setValue('text'); cursor(0); key('Tab'); assert(editor.value === '   text', 'Prose ignored 3-space indent');
    key('Tab', { shiftKey: true }); assert(editor.value === 'text', 'Shift Tab did not outdent prose');
    editor.setValue('```java\ncode\n```'); cursor(editor.value.indexOf('code')); key('Tab');
    assert(editor.value.includes('\n  code\n'), 'Code ignored 2-space indent');
  });
  await test('Rendered task checkboxes modify the matching source and undo restores it', async () => {
    editor.setValue('Before\n\n- [ ] first\n- [x] second\n\nAfter'); cursor(0); await frame();
    assert(parent.querySelectorAll('.cm-native-list').length === 2, 'Task list did not retain native rows');
    parent.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    assert(editor.value.includes('- [x] first\n- [x] second'), 'Checkbox click did not toggle the right task');
    undo(view); assert(editor.value.includes('- [ ] first'), 'Checkbox change did not enter undo history');
  });
  await test('Quotes and nested lists keep their structure and other inline formats while editing', async () => {
    editor.setValue('Before\n\n> Quote **bold**\n> Next quote line\n\n- List **bold**\n- Next item\n  - Nested item\n\nAfter');
    cursor(editor.value.length); await frame();
    assert(parent.querySelectorAll('.cm-native-quote').length === 2 && parent.querySelectorAll('.cm-native-list').length === 3, 'Text quotes/lists fell back to a block source editor');
    const measure = () => Array.from(parent.querySelectorAll('.cm-native-quote, .cm-native-list')).map((node) => node.getBoundingClientRect().top);
    const initial = measure();
    cursor(editor.value.indexOf('Quote')); await frame();
    assert(measure().every((value, index) => Math.abs(value - initial[index]) < .5), 'Quote/list moved when focused');
    assert(!view.contentDOM.innerText.includes('>') && !view.contentDOM.innerText.includes('- '), 'Structural markers appeared during editing');
    assert(parent.querySelectorAll('.cm-md-strong').length === 2, 'Entering quote exposed unrelated bold syntax');
    insert('Edited '); assert(editor.value.includes('> Edited Quote **bold**'), 'Quote editing damaged its marker');
    cursor(editor.value.indexOf('List')); key('Backspace');
    assert(editor.value.includes('\nList **bold**'), 'List-start Backspace did not remove formatting');
    undo(view); assert(editor.value.includes('- List **bold**'), 'List formatting did not undo');
    cursor(editor.value.indexOf('Nested')); key('ArrowLeft');
    assert(view.state.selection.main.head < editor.value.indexOf('  - Nested'), 'Left arrow got trapped in a hidden list prefix');
  });
  await test('Math fences show math until focused, then expose an editable code box', async () => {
    editor.setValue('Before\n\n```math\nx^2 + y^2\n```\n\nAfter'); cursor(0); await frame();
    assert(parent.querySelector('.md-math-block'), 'Math fence did not render');
    click('.md-block-widget[data-kind="fence"]'); await frame();
    assert(parent.querySelector('.cm-code-line'), 'Math fence did not become editable');
    cursor(editor.value.length); await frame(); assert(parent.querySelector('.md-math-block'), 'Math fence did not render after blur');
  });
  await test('Strict parsing, smart punctuation and exported line breaks obey options', () => {
    setDialect({ strictMode: true }); assert(!renderDocument('#No space').html.includes('<h1'), 'Strict mode accepted invalid heading');
    setDialect({ strictMode: false }); assert(renderDocument('#No space').html.includes('<h1'), 'Relaxed mode rejected heading');
    setDialect({ smartQuotes: true, smartDash: true });
    const smart = renderDocument('"quoted" -- text').html;
    assert(smart.includes('“quoted”') && !smart.includes(' -- '), 'Rendering did not convert smart punctuation');
    assert(renderDocument('one\ntwo', { preserveLineBreaks: true }).html.includes('<br>'), 'Preserved line break missing');
    assert(!renderDocument('one\ntwo', { preserveLineBreaks: false }).html.includes('<br>'), 'Ignored line break still present');
  });
  await test('Copy mode and line-wise cut produce correct text and preserve undo', () => {
    editor.setValue('**Bold**\nAfter'); cursor(2); editor.configure({ lineWiseCopyCut: true });
    const rich = new DataTransfer(); view.contentDOM.dispatchEvent(new ClipboardEvent('copy', { clipboardData: rich, bubbles: true, cancelable: true }));
    assert(rich.getData('text/plain').trim() === 'Bold' && rich.getData('text/html').includes('<strong>'), 'Rich copy lost rendered content');
    editor.configure({ lineWiseCopyCut: true, copyMarkdownAsPlain: true });
    const raw = new DataTransfer(); view.contentDOM.dispatchEvent(new ClipboardEvent('cut', { clipboardData: raw, bubbles: true, cancelable: true }));
    assert(raw.getData('text/plain') === '**Bold**\n' && editor.value === 'After', 'Raw line cut lost Markdown or deleted adjacent line');
    undo(view); assert(editor.value === '**Bold**\nAfter', 'Cut could not undo');
  });
  await test('Only the inline format containing the caret reveals its markers', async () => {
    editor.setValue('Text **bold** and *italic* and [label](https://example.test)'); cursor(0); await frame();
    assert(!view.contentDOM.innerText.includes('**') && !view.contentDOM.innerText.includes('https://'), 'Inactive inline source leaked');
    assert(parent.querySelector('.cm-md-strong') && parent.querySelector('.cm-md-emphasis') && parent.querySelector('.cm-md-link'), 'Inline text lost its formatting');
    cursor(editor.value.indexOf('bold') + 2); await frame();
    assert(view.contentDOM.innerText.includes('**bold**') && !view.contentDOM.innerText.includes('*italic*') && !view.contentDOM.innerText.includes('https://'), 'Focusing bold exposed unrelated inline source');
    insert('X'); assert(editor.value.includes('**boXld**'), 'Inline edit did not change source at the native caret');
    undo(view); assert(editor.value.includes('**bold**'), 'Inline editing did not undo');
    cursor(editor.value.indexOf('label') + 1); await frame(); assert(view.contentDOM.innerText.includes('https://example.test'), 'Link destination could not be edited');
  });
  await test('Inline math edits only its TeX, keeps adjacent formatting, and shows a floating preview', async () => {
    editor.setValue('Before **bold** and $E = mc^2$ with *italic*.\n\nAfter'); cursor(0); await frame();
    assert(parent.querySelector('.cm-inline-math-widget'), 'Inline formula did not render as its own widget');
    assert(parent.querySelector('.cm-md-strong') && parent.querySelector('.cm-md-emphasis'), 'Math paragraph lost nearby formatting');
    click('.cm-inline-math-widget'); await frame();
    const selection = view.state.selection.main;
    assert(view.state.sliceDoc(selection.from, selection.to) === 'E = mc^2', 'Clicking formula did not select just the TeX body');
    assert(parent.querySelector('.cm-md-strong') && parent.querySelector('.cm-md-emphasis'), 'Clicking math exposed all paragraph markers');
    assert(document.querySelector('.cm-inline-math-tooltip'), 'Active formula has no floating preview');
    insert('\\alpha_i + 1'); await frame();
    assert(parent.querySelector('.cm-md-math-source')?.textContent === '\\alpha_i + 1', 'TeX escapes/underscores were parsed as Markdown');
    cursor(editor.value.length); await frame();
    assert(parent.querySelector('.cm-inline-math-widget')?.getAttribute('data-tex') === '\\alpha_i + 1' && !document.querySelector('.cm-inline-math-tooltip'), 'Formula did not return to inline rendering after leaving');
    undo(view); assert(editor.value.includes('$E = mc^2$'), 'Math edit did not undo');
    editor.setValue('`$literal$` and \\$escaped$'); cursor(0); await frame();
    assert(!parent.querySelector('.cm-inline-math-widget'), 'Code or escaped dollars became math');
  });
  await test('HTML images keep editable source and a correctly sized persistent preview', async () => {
    const url = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="blue"/></svg>');
    const image = '<img src="' + url + '" alt="Sized" width="120" style="height:80px;zoom:50%;border:20px solid red" />';
    editor.setValue('Before\n\n' + image + '\n\nAfter'); cursor(editor.value.length); await frame();
    let preview = parent.querySelector<HTMLImageElement>('.cm-image-preview img')!;
    assert(preview && preview.style.width === '120px' && preview.style.height === '80px' && (preview.style.zoom === '50%' || Number(preview.style.zoom) === .5), 'HTML image dimensions were ignored: ' + preview?.outerHTML);
    assert(!preview.style.border, 'HTML image preview should leave unrelated styles for export');
    const size = preview.getBoundingClientRect(); assert(size.width === 60 && size.height === 40, 'HTML zoom did not resize the preview');
    click('.cm-image-preview img'); await frame();
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === image, 'HTML image click should select the entire tag');
    assert(parent.querySelector('.cm-native-image-source') && parent.querySelector('.cm-image-preview img'), 'HTML source editing removed its preview');
    const from = editor.value.indexOf('width="120"') + 'width="'.length;
    view.dispatch({ changes: { from, to: from + 3, insert: '160' }, userEvent: 'input' }); await frame();
    preview = parent.querySelector<HTMLImageElement>('.cm-image-preview img')!;
    assert(preview.style.width === '160px', 'Editing HTML dimensions did not update the preview');
    undo(view); assert(editor.value.includes('width="120"'), 'HTML size edit did not undo');
    editor.setSourceMode(true); await frame(); assert(!parent.querySelector('.cm-image-preview'), 'Source mode should show only the original HTML');
  });
  await test('Image zoom and syntax conversion retain paths, alt text, titles and existing HTML attributes', () => {
    const image = '![Sample](picture.svg "Caption")', zoomed = transformImage(image, 'image:zoom:50')!;
    assert(zoomed === '<img src="picture.svg" alt="Sample" title="Caption" style="zoom:50%;" />', '50% did not use the native HTML representation');
    const resized = transformImage('<img src="a%20b.png" alt="A &amp; B" width="120" style="height:80px;zoom:25%;border:0" />', 'image:zoom:67')!;
    const parsed = new DOMParser().parseFromString(resized, 'text/html').querySelector('img')!;
    assert(parsed.getAttribute('width') === '120' && parsed.style.height === '80px' && parsed.alt === 'A & B', 'Zoom discarded existing image properties');
    assert(parsed.getAttribute('style')!.includes('zoom:67%') && !parsed.getAttribute('style')!.includes('25%'), 'Zoom stacked old and new scale factors');
    assert(transformImage(zoomed, 'image:markdown') === image, 'Converting back lost the image metadata');
    assert(transformImage(zoomed, 'image:zoom:0') === null, 'An unsupported scale was accepted');
  });
  await test('Raw HTML image paths resolve in blocks and inline text without rewriting data-src', () => {
    const input = '<img data-src="keep.png" src="a%20b.png" width="120" style="zoom:50%;border:0" />';
    for (const source of [input, 'Before ' + input + ' after']) {
      const html = new DOMParser().parseFromString(renderDocument(source, { resolveSrc: (src) => 'file:///document/' + src }).html, 'text/html');
      const image = html.querySelector('img')!;
      assert(image.getAttribute('src') === displayFileUrl('file:///document/a%20b.png') && image.getAttribute('data-src') === 'keep.png', 'HTML image resolver rewrote the wrong attribute: ' + image.outerHTML);
      assert(image.getAttribute('width') === '120' && image.style.border === '0px', 'HTML image export lost original dimensions/styles');
    }
  });
  await test('Failed images show their Markdown, edit without a duplicate preview, and recover after a path change', async () => {
    const source = 'Before\n\n![Missing](missing-image.png)\n\nAfter';
    editor.setValue(source); cursor(source.length); await frame();
    const image = parent.querySelector<HTMLImageElement>('.cm-image-preview img')!;
    image.dispatchEvent(new Event('error')); await frame();
    const fallback = parent.querySelector<HTMLElement>('.cm-image-preview')!;
    assert(fallback.innerText.includes('![Missing](missing-image.png)') && image.hidden, 'Failed image exposed a browser broken-image placeholder');
    click('.cm-image-fallback'); await frame();
    assert(parent.querySelector('.cm-native-image-source') && parent.querySelector<HTMLElement>('.cm-image-preview')!.hidden, 'Failed image editing duplicated the visible Markdown');
    const path = editor.value.indexOf('missing-image.png');
    view.dispatch({ changes: { from: path, to: path + 'missing-image.png'.length, insert: 'replacement.png' }, userEvent: 'input' }); await frame();
    const replacement = parent.querySelector<HTMLImageElement>('.cm-image-preview img')!;
    replacement.dispatchEvent(new Event('load')); await frame();
    assert(!replacement.hidden && !replacement.parentElement!.hidden, 'A repaired image path remained in the failed state');
    undo(view); assert(editor.value === source, 'Repairing an image path did not undo');
  });
  await test('Standalone image editing retains its preview and commits alt/path changes through the same undo history', async () => {
    editor.setValue('Before **bold**\n\n![Original](picture.png "Caption")\n\nAfter *italic*'); cursor(editor.value.length); await frame();
    assert(parent.querySelector('.cm-image-preview img'), 'Standalone image has no persistent preview');
    click('.cm-image-preview img'); await frame();
    const selection = view.state.selection.main;
    assert(view.state.sliceDoc(selection.from, selection.to) === 'Original', 'Image click did not select its alt text');
    assert(parent.querySelector('.cm-native-image-source') && parent.querySelector('.cm-image-preview img'), 'Editing image removed its preview');
    insert('Edited'); await frame();
    assert(parent.querySelector<HTMLImageElement>('.cm-image-preview img')?.alt === 'Edited', 'Image preview did not follow alt edits');
    undo(view); assert(editor.value.includes('![Original]'), 'Image edit did not undo');
    cursor(editor.value.length); await frame();
    assert(!parent.querySelector('.cm-native-image-source') && parent.querySelector('.cm-image-preview img'), 'Leaving image did not hide source while retaining preview');
    editor.setSourceMode(true); await frame(); assert(view.contentDOM.innerText.includes('picture.png'), 'Source mode hid the image Markdown');
  });
  await test('Inline parsing preserves nested emphasis, escapes and source mode', async () => {
    const source = 'Text \\*literal\\* and **outer *inner* text** and `a ** b`';
    editor.setValue(source); cursor(0); await frame();
    assert(parent.querySelector('.cm-md-emphasis')?.textContent === 'inner', 'Nested emphasis parsed incorrectly');
    assert(parent.querySelector('.cm-md-code')?.textContent === 'a ** b', 'Code interpreted emphasis markers');
    assert(view.contentDOM.innerText.includes('*literal*') && !view.contentDOM.innerText.includes('\\*'), 'Escaped literal was not displayed literally');
    editor.setSourceMode(true); await frame(); assert(view.contentDOM.innerText.includes('**outer *inner* text**'), 'Source mode kept hiding inline markers');
    assert(editor.value === source, 'Rendering rewrote Markdown');
  });
  await test('Sentence selection and deletion preserve neighboring sentences and paragraph structure', async () => {
    const source = 'Intro\n\nFirst sentence. Second sentence! Third sentence?\n\nTail';
    editor.setValue(source); cursor(source.indexOf('Second') + 3);
    rangeAction(editor, 'selectLine');
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'Second sentence! ', 'Sentence selection grabbed an entire source line or omitted trailing space');
    rangeAction(editor, 'deleteLine');
    assert(editor.value === source.replace('Second sentence! ', ''), 'Sentence deletion damaged an adjacent sentence or paragraph');
    undo(view); assert(editor.value === source, 'Sentence deletion did not undo');
    editor.setValue('第一句话。第二句话！第三句话？'); cursor(7); rangeAction(editor, 'selectLine');
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === '第二句话！', 'Chinese sentence boundaries were ignored');
  });
  await test('Styled scope selects only its body and deletes delimiters; words preserve surrounding text', async () => {
    const source = 'Before **bold scope** and *italic part* plus `code one` after.';
    editor.setValue(source); cursor(source.indexOf('bold') + 3); rangeAction(editor, 'selectStyled');
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'bold scope', 'Styled selection included hidden delimiters');
    rangeAction(editor, 'deleteStyled'); assert(editor.value === source.replace('**bold scope**', ''), 'Styled deletion left delimiters or removed the neighboring style');
    undo(view); assert(editor.value === source, 'Styled deletion did not undo');
    editor.setValue('First sentence. Second sentence! Tail'); cursor(22); rangeAction(editor, 'selectWord');
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'Second', 'Word selection included adjacent space');
    rangeAction(editor, 'deleteWord'); assert(editor.value === 'First sentence. sentence! Tail', 'Word deletion did not consume its trailing space');
  });
  await test('Native selection synchronization maps visible text past hidden markers for menu commands', async () => {
    const source = '# Title\n\nFirst **bold** and second sentence.';
    editor.setValue(source); cursor(source.indexOf('First')); await frame();
    const node = parent.querySelector('.cm-md-strong')!.firstChild!, range = document.createRange();
    range.setStart(node, 1); range.setEnd(node, 3); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    editor.syncNativeSelection();
    assert(view.state.selection.main.from === source.indexOf('bold') + 1 && view.state.selection.main.to === source.indexOf('bold') + 3, 'Native selection was mapped through visible rather than source offsets');
    rangeAction(editor, 'selectStyled'); assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'bold', 'Menu used the stale caret after native selection');
  });
  await test('Code line deletion preserves fences and block deletion removes a complete multiline paragraph', async () => {
    const source = 'Before\n\n```java\nfirst();\nsecond();\nthird();\n```\n\nAfter';
    editor.setValue(source); cursor(source.indexOf('second') + 3); rangeAction(editor, 'selectLine');
    assert(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) === 'second();', 'Code selection included a fence or adjacent line');
    rangeAction(editor, 'deleteLine'); assert(editor.value === source.replace('second();\n', ''), 'Code line deletion damaged its fences');
    undo(view); assert(editor.value === source, 'Code line deletion did not undo');
    editor.setValue('Before\n\nA multiline\nparagraph.\n\nAfter'); cursor(23); rangeAction(editor, 'deleteBlock');
    assert(editor.value === 'Before\n\nAfter', 'Delete Block removed only one source line or kept a stray separator');
  });
  await test('Table cells open only the inline style containing the native caret', async () => {
    const text = 'Apple **bold** and *italic* and [link](https://example.com)';
    const source = '| Item |\n| --- |\n| ' + text + ' |';
    editor.setValue(source); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('td')!; cellSelection(cell, 2); await frame();
    assert(!cell.innerText.includes('**') && !cell.innerText.includes('*italic*') && !cell.innerText.includes('https://'), 'Plain cell focus revealed all Markdown');
    assert(cell.querySelector('.cm-md-strong') && cell.querySelector('.cm-md-emphasis') && cell.querySelector('.cm-md-link'), 'Plain cell focus lost its other formats');
    cellSelection(cell, text.indexOf('bold') + 2); await frame();
    assert(cell.innerText.includes('**bold**') && !cell.innerText.includes('*italic*') && !cell.innerText.includes('https://'), 'Bold cell focus opened unrelated formats');
    const data = new DataTransfer(); data.setData('text/plain', 'X');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value.includes('**boXld** and *italic* and [link](https://example.com)'), 'Editing a projected cell damaged hidden markers');
    undo(view); await frame(); assert(editor.value === source, 'Projected cell edit did not undo');
    cellSelection(cell, text.indexOf('italic') + 2); await frame();
    assert(!cell.innerText.includes('**bold**') && cell.innerText.includes('*italic*'), 'Moving the caret did not switch the active inline format');
    cell.blur(); await frame(); assert(!cell.innerText.includes('**') && cell.querySelector('.cm-md-strong'), 'Leaving the cell did not restore its rendered text');
  });
  await test('Table inline composition preserves surrounding Markdown and commits once', async () => {
    const source = '| Item |\n| --- |\n| **bold** and *italic* |';
    editor.setValue(source); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('td')!; cellSelection(cell, 4); await frame();
    cell.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); cell.textContent = '**中文** and *italic*';
    cell.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
    assert(editor.value === source, 'Composition candidate was committed too early');
    cell.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await frame();
    assert(editor.value.includes('**中文** and *italic*') && cell.querySelector('.cm-md-emphasis'), 'Composition confirmation lost the neighboring style');
    undo(view); assert(editor.value === source, 'Composition cannot be undone as one edit');
  });
  await test('Table math opens only its TeX and keeps rendered labels out of Markdown edits', async () => {
    const text = 'Plain **bold** and $x^2+1$ end', source = '| A | B |\n| --- | --- |\n| ' + text + ' | Other |';
    editor.setValue(source); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('td')!;
    const preview = cell.querySelector<HTMLElement>('.md-table-math-preview');
    assert(preview && !cell.innerText.includes('$'), 'Inactive table formula was left as Markdown');
    preview.innerHTML = '<svg><text>RENDERED_LABEL</text></svg>';
    cellSelection(cell, 2); await frame();
    const data = new DataTransfer(); data.setData('text/plain', 'Z');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value === source.replace('Plain', 'PlZain'), 'Typing beside math copied SVG labels or lost formula source');
    cell.querySelector('.md-table-math-preview')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(window.getSelection()?.toString() === 'x^2+1' && cell.innerText.includes('$x^2+1$'), 'Clicking table math did not select only the TeX body');
    assert(cell.querySelector('.cm-md-strong') && !cell.innerText.includes('**bold**') && parent.querySelector('.md-table-math-tooltip'), 'Table math editing exposed neighboring formats or lost floating preview');
    data.setData('text/plain', 'y+2'); cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value.includes('**bold** and $y+2$ end'), 'Editing table TeX damaged delimiters or adjacent source');
    assert(cell.isConnected && document.activeElement === cell, 'Math edit replaced the active cell: connected=' + cell.isConnected + ' focus=' + document.activeElement?.tagName);
    cursor(editor.value.length); await frame();
    assert(!parent.querySelector('.md-table-math-tooltip') && cell.querySelector('.md-table-math-preview'), 'Leaving table math did not restore preview and close tooltip');
    undo(view); await frame(); assert(editor.value.includes('$x^2+1$'), 'Table math edit did not undo');
  });
  await test('Table math arrow and delete boundaries edit source without losing neighboring content', async () => {
    const text = 'Before $x+1$ after', source = '| A |\n| --- |\n| ' + text + ' |';
    editor.setValue(source); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('td')!, end = text.indexOf('$ after') + 1;
    cellSelection(cell, end); cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await frame();
    assert(cell.innerText.includes('$x+1$') && parent.querySelector('.md-table-math-tooltip'), 'Arrow into a collapsed formula did not open it');
    cellSelection(cell, end); cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); await frame();
    assert(editor.value === source.replace('$x+1$', '$x+1'), 'Backspace at math boundary deleted a rendered node instead of source');
    undo(view); await frame(); assert(editor.value === source, 'Math boundary deletion did not undo');
  });
  await test('Table range actions select styled bodies and whole rows, then delete exactly the current row', async () => {
    const source = '| A | B |\n| --- | --- |\n| **bold** and $x+1$ | Other |\n| Keep | Tail |';
    editor.setValue(source); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('td')!; cellSelection(cell, 4);
    editor.handleTableAction('selectStyled'); assert(window.getSelection()?.toString() === 'bold', 'Table styled selection included delimiters');
    editor.handleTableAction('selectLine'); await frame();
    const selection = window.getSelection()!;
    assert(selection.anchorNode && cell.contains(selection.anchorNode) && selection.focusNode && cell.nextElementSibling!.contains(selection.focusNode), 'Select Line did not span the current table row');
    editor.handleTableAction('deleteLine'); await frame();
    assert(editor.value === '| A | B |\n| --- | --- |\n| Keep | Tail |', 'Delete Line did not remove precisely the current table row');
    undo(view); await frame(); assert(editor.value === source, 'Table row deletion did not undo');
  });
  await test('Table cell editing stays in the grid, escapes pipes and participates in undo', async () => {
    editor.setValue('Before\n\n| Item | Count |\n| :--- | ---: |\n| Apple | 2 |\n| Banana | 3 |\n\nAfter'); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!; assert(cell, 'Table has no editable cells');
    cell.focus(); cell.textContent = 'Pear | 黄'; cell.dispatchEvent(new Event('input', { bubbles: true })); await frame();
    assert(editor.value.includes('| Pear \\| 黄 | 2 |'), 'Cell input did not escape a literal pipe: ' + JSON.stringify(editor.value));
    assert(document.activeElement === cell && parent.querySelectorAll('tbody tr').length === 2, 'Editing replaced the focused grid or changed its rows');
    undo(view); await frame(); assert(cell.textContent === 'Apple' && editor.value.includes('| Apple | 2 |'), 'Undo did not restore cell and source together');
    redo(view); await frame(); assert(cell.textContent === 'Pear | 黄', 'Redo lost the cell edit');
  });
  await test('Table Tab adds a row, Enter selects the next row and Shift Enter inserts a line break', async () => {
    editor.setValue('Before\n\n| Item | Count |\n| --- | --- |\n| Apple | 2 |\n| Banana | 3 |\n\nAfter'); cursor(0); await frame();
    const cell = (r: number, c: number) => parent.querySelector<HTMLElement>(`[data-row="${r}"][data-col="${c}"]`)!;
    cell(1, 0).focus(); cell(1, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(document.activeElement === cell(2, 0) && window.getSelection()?.toString() === 'Banana', 'Enter did not select the same column in the next row');
    cell(2, 1).focus(); cell(2, 1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); await frame();
    assert(parent.querySelectorAll('tbody tr').length === 3 && document.activeElement === cell(3, 0), 'Tab at the last cell did not add/focus a new row');
    cell(3, 0).textContent = 'one'; cell(3, 0).dispatchEvent(new Event('input', { bubbles: true }));
    const range = document.createRange(); range.selectNodeContents(cell(3, 0)); range.collapse(false); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    cell(3, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    assert(editor.value.includes('one<br>'), 'Shift Enter did not preserve a cell line break');
  });
  await test('Table alignment and row/column tools change Markdown without moving nearby blocks on focus', async () => {
    editor.setValue('Before\n\n| Item | Count |\n| --- | --- |\n| Apple | 2 |\n\nAfter'); cursor(0); await frame();
    const root = parent.querySelector<HTMLElement>('.md-table-widget')!, top = root.getBoundingClientRect().top;
    parent.querySelector<HTMLElement>('[data-row="1"][data-col="1"]')!.focus(); await frame();
    assert(Math.abs(root.getBoundingClientRect().top - top) < .5, 'Table toolbar changed block geometry');
    const text = document.createRange(); text.selectNodeContents(parent.querySelector('.cm-line')!);
    const toolbarTop = root.querySelector('.md-table-toolbar')!.getBoundingClientRect().top, textBottom = text.getBoundingClientRect().bottom;
    assert(toolbarTop >= textBottom, `Table toolbar overlaps preceding paragraph text: ${toolbarTop} < ${textBottom}`);
    root.querySelector<HTMLButtonElement>('[data-action="center"]')!.click(); await frame();
    assert(editor.value.includes('| --- | :---: |'), 'Column alignment was not saved');
    root.querySelector<HTMLButtonElement>('[data-action="columnAfter"]')!.click(); await frame();
    assert(parent.querySelectorAll('th').length === 3, 'Insert column did not resize grid');
    parent.querySelector<HTMLButtonElement>('.md-table-menu [data-action="deleteColumn"]')!.click(); await frame();
    assert(parent.querySelectorAll('th').length === 2 && editor.value.includes('Before') && editor.value.includes('After'), 'Delete column damaged table or neighbouring blocks');
  });
  await test('Table Command Enter inserts a row and Command Shift Backspace removes it with undo', async () => {
    editor.setValue('Before\n\n| A | B |\n| --- | --- |\n| Apple | 2 |\n| Banana | 3 |\n\nAfter'); cursor(0); await frame();
    const cell = (r: number) => parent.querySelector<HTMLElement>(`[data-row="${r}"][data-col="0"]`)!;
    cell(1).focus(); cell(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true })); await frame();
    assert(editor.value.includes('| Apple | 2 |\n|  |  |\n| Banana | 3 |') && document.activeElement === cell(2), 'Command Enter moved instead of inserting a row');
    cell(2).dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, shiftKey: true, bubbles: true, cancelable: true })); await frame();
    assert(editor.value.includes('| Apple | 2 |\n| Banana | 3 |') && document.activeElement === cell(2), 'Delete-row shortcut damaged the table or lost focus');
    undo(view); await frame(); assert(parent.querySelectorAll('tbody tr').length === 3, 'Delete row cannot undo');
  });
  await test('Table menu commands use the focused row and column', async () => {
    editor.setValue('| A | B |\n| --- | --- |\n| one | two |'); cursor(0); await frame();
    parent.querySelector<HTMLElement>('[data-row="1"][data-col="1"]')!.focus();
    assert(editor.handleTableAction('insertParagraphAfter'), 'Application Command Enter action was not intercepted by the table'); await frame();
    assert(parent.querySelectorAll('tbody tr').length === 2, 'Application shortcut did not add a row');
    assert(editor.handleTableAction('tableColumnBefore'), 'Column menu command missed the focused cell'); await frame();
    assert(editor.value.includes('| A |  | B |') && parent.querySelectorAll('th').length === 3, 'Column command changed the wrong column');
    assert(editor.handleTableAction('tableDeleteColumn'), 'Delete column command did not route'); await frame();
    assert(parent.querySelectorAll('th').length === 2, 'Column command cannot remove a column');
  });
  await test('Table size grid preserves existing cells, supports numeric dimensions and undo', async () => {
    editor.setValue('Before\n\n| A | B |\n| :--- | ---: |\n| one | two |\n\nAfter'); cursor(0); await frame();
    parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!.focus();
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click();
    const panel = parent.querySelector<HTMLElement>('.md-table-resize')!;
    assert(!panel.hidden && panel.querySelectorAll('[role="gridcell"]').length === 60, 'Resize did not show a six-column ten-row grid');
    panel.querySelector<HTMLButtonElement>('[data-rows="4"][data-columns="3"]')!.click(); await frame();
    assert(parent.querySelectorAll('th').length === 3 && parent.querySelectorAll('tr').length === 4 && editor.value.includes('| one | two |  |'), 'Grid resize lost data or dimensions');
    assert(editor.value.includes('| :--- | ---: | --- |'), 'Grid resize lost column alignment');
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click();
    const columns = parent.querySelector<HTMLInputElement>('.md-table-resize [data-dimension="columns"]')!, rows = parent.querySelector<HTMLInputElement>('.md-table-resize [data-dimension="rows"]')!;
    (document.activeElement as HTMLElement).blur(); await frame();
    assert(!columns.closest<HTMLElement>('.md-table-resize')!.hidden, 'A transient native focus loss closed the panel before its input could receive focus');
    columns.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(document.activeElement === columns && !columns.closest<HTMLElement>('.md-table-resize')!.hidden, 'Dimension field lost focus or closed its panel');
    assert(!editor.handleTableAction('selectAll'), 'Table Select All stole the dimension input native selection');
    columns.value = '7'; rows.value = '12'; rows.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await frame();
    assert(parent.querySelectorAll('th').length === 7 && parent.querySelectorAll('tr').length === 12 && editor.value.includes('Before') && editor.value.includes('After'), 'Numeric resize did not exceed the grid or damaged adjacent paragraphs');
    undo(view); await frame(); assert(parent.querySelectorAll('th').length === 3 && parent.querySelectorAll('tr').length === 4, 'Resize cannot undo');
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click();
    const unchanged = parent.querySelector<HTMLInputElement>('.md-table-resize [data-dimension="rows"]')!;
    unchanged.focus(); unchanged.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await frame();
    assert(document.activeElement?.matches('td,th'), 'Accepting unchanged dimensions left focus in a hidden field');
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    assert(parent.querySelector<HTMLElement>('.md-table-resize')!.hidden, 'Clicking outside did not dismiss the size panel');
  });
  await test('Pasted spreadsheet cells expand the grid and IME waits for composition completion', async () => {
    editor.setValue('Before\n\n| A | B |\n| --- | --- |\n| one | two |\n\nAfter'); cursor(0); await frame();
    const cell = parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!; cell.focus();
    const data = new DataTransfer(); data.setData('text/plain', 'apple\t2\nbanana\t3');
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); await frame();
    assert(editor.value.includes('| apple | 2 |\n| banana | 3 |'), 'TSV paste did not fill a rectangular grid');
    const active = parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!; active.focus();
    active.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); active.textContent = '中文';
    active.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
    assert(editor.value.includes('| apple | 2 |'), 'IME candidate updated source before confirmation');
    active.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    assert(editor.value.includes('| 中文 | 2 |'), 'IME confirmation was not committed');
  });
  await test('Focused table replacement and column moves preserve the new document after blur', async () => {
    editor.setValue('| A | B |\n| --- | --- |\n| one | two |'); await frame();
    parent.querySelector<HTMLElement>('td[data-col="0"]')!.focus();
    assert(editor.handleTableAction('tableColumnRight'), 'Column move missed the focused table'); await frame();
    assert(editor.value === '| B | A |\n| --- | --- |\n| two | one |', 'Blur overwrote a moved cell');
    parent.querySelector<HTMLElement>('td[data-col="1"]')!.focus();
    editor.setValue('Replacement document'); await frame();
    assert(editor.value === 'Replacement document', 'A retired table wrote into the replacement document');
  });
  editor.configure({});
  editor.setValue('# Aropyt\n\n可直接编辑代码，Mermaid 编辑时保留实时图形预览。\n\n```java\npublic class Demo {\n    public static void main(String[] args) {\n        System.out.println("Hello, Aropyt!");\n    }\n}\n```\n\n```mermaid\ngraph LR\n    A[Markdown] --> B[编辑]\n    B --> C[预览]\n```\n\n继续书写。');
  cursor(editor.value.indexOf('System'));
  await frame();
  assert(!runtimeErrors.length, 'Editor emitted an uncaught error: ' + runtimeErrors.join('; '));
  return passed;
};

// Used by the Electron harness to test real Chromium input, in addition to
// synthetic commands above (which cannot perform native text insertion).
(window as any).prepareNativeLanguageTest = () => {
  editor.setValue('Before\n\n```text lineno\nint n = 1;\n```\n\nAfter'); cursor(editor.value.indexOf('int n'));
  const input = parent.querySelector<HTMLInputElement>('.cm-code-language')!;
  input.focus(); input.select();
};
(window as any).editorValue = () => editor.value;
(window as any).prepareNativeTableTest = async () => {
  editor.setSourceMode(false); editor.setValue('Before\n\n| Item | Count |\n| --- | --- |\n| Apple | 2 |\n\nAfter'); await frame();
  const cell = parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!; cell.focus();
  const range = document.createRange(); range.selectNodeContents(cell); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
};
(window as any).prepareNativeTableResizeTest = async (field = '列数') => {
  if (field === '列数') {
    editor.setSourceMode(false); editor.setValue('Before\n\n| A | B |\n| --- | --- |\n| one | two |\n\nAfter'); await frame();
    parent.querySelector<HTMLElement>('[data-row="1"][data-col="0"]')!.focus();
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click(); await frame();
  }
  const input = parent.querySelector<HTMLInputElement>(`.md-table-resize [data-dimension="${field === '列数' || field === 'Columns' ? 'columns' : 'rows'}"]`)!;
  const box = input.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};
(window as any).verifyNativeTableResizeTest = () => {
  assert(parent.querySelectorAll('th').length === 3 && parent.querySelectorAll('tr').length === 4, 'Native dimension input did not resize the table: ' + JSON.stringify({ value: editor.value, focus: document.activeElement?.outerHTML.slice(0, 200) }));
  assert(editor.value.includes('| one | two |  |') && editor.value.includes('Before') && editor.value.includes('After'), 'Native dimension input leaked into the document');
};
