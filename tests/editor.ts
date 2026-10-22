import { undo, redo } from '@codemirror/commands';
import { DocEditor, setBlockRenderer, setSingleBlockRenderer } from '../src/renderer/editor';
import { blockRanges, renderDocument, setDialect } from '../src/renderer/md';
import { documentStatistics } from '../src/shared/document-statistics';
import { transformImage } from '../src/renderer/image-actions';
import { rangeAction } from '../src/renderer/editing-commands';

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
    key('Enter'); assert(editor.value === '9. ninth\n', 'Empty list item did not exit');
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
      assert(image.getAttribute('src') === 'file:///document/a%20b.png' && image.getAttribute('data-src') === 'keep.png', 'HTML image resolver rewrote the wrong attribute');
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
    const columns = parent.querySelector<HTMLInputElement>('.md-table-resize [aria-label="列数"]')!, rows = parent.querySelector<HTMLInputElement>('.md-table-resize [aria-label="行数"]')!;
    (document.activeElement as HTMLElement).blur(); await frame();
    assert(!columns.closest<HTMLElement>('.md-table-resize')!.hidden, 'A transient native focus loss closed the panel before its input could receive focus');
    columns.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); await frame();
    assert(document.activeElement === columns && !columns.closest<HTMLElement>('.md-table-resize')!.hidden, 'Dimension field lost focus or closed its panel');
    assert(!editor.handleTableAction('selectAll'), 'Table Select All stole the dimension input native selection');
    columns.value = '7'; rows.value = '12'; rows.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await frame();
    assert(parent.querySelectorAll('th').length === 7 && parent.querySelectorAll('tr').length === 12 && editor.value.includes('Before') && editor.value.includes('After'), 'Numeric resize did not exceed the grid or damaged adjacent paragraphs');
    undo(view); await frame(); assert(parent.querySelectorAll('th').length === 3 && parent.querySelectorAll('tr').length === 4, 'Resize cannot undo');
    parent.querySelector<HTMLButtonElement>('[data-action="resize"]')!.click();
    const unchanged = parent.querySelector<HTMLInputElement>('.md-table-resize [aria-label="行数"]')!;
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
  const input = parent.querySelector<HTMLInputElement>(`.md-table-resize [aria-label="${field}"]`)!;
  const box = input.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};
(window as any).verifyNativeTableResizeTest = () => {
  assert(parent.querySelectorAll('th').length === 3 && parent.querySelectorAll('tr').length === 4, 'Native dimension input did not resize the table: ' + JSON.stringify({ value: editor.value, focus: document.activeElement?.outerHTML.slice(0, 200) }));
  assert(editor.value.includes('| one | two |  |') && editor.value.includes('Before') && editor.value.includes('After'), 'Native dimension input leaked into the document');
};
