const featureWait = async (predicate: () => boolean | Promise<boolean>) => {
  for (let n = 0; n < 200; n++) { if (await predicate()) return; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('Feature test timed out: ' + predicate.toString());
};
const featureAssert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

(window as any).runFeatureChecks = async () => {
  await featureWait(() => !!(window as any).__aropyt);
  const api = (window as any).__aropyt, editor = api.getEditor(), bridge = (window as any).JSBridge;
  const passed: string[] = [];
  featureAssert(api.state.panel === 'files' && document.getElementById('sidebar-search-reveal')!.inert && document.getElementById('sidebar-search-btn')!.hidden, 'Sidebar did not start on Files with its search field collapsed');
  featureAssert(!!document.querySelector('.file-list-card .file-card-preview'), 'A fresh sidebar did not show document summaries by default');
  const cursor = (text: string) => editor.view.dispatch({ selection: { anchor: editor.value.indexOf(text) } });
  editor.setValue('## Title\n\n**Bold** and [a link](https://example.test)\n');
  const from = editor.value.indexOf('**');
  editor.view.dispatch({ selection: { anchor: from, head: editor.value.indexOf('\n', from) } });
  await api.runAction('copyPlain');
  featureAssert(await bridge.invoke('clipboard.read') === 'Bold and a link', 'Plain copy kept Markdown syntax');
  await api.runAction('copyAsMarkdown');
  featureAssert((await bridge.invoke('clipboard.read')).startsWith('**Bold**'), 'Markdown copy lost source');
  await api.runAction('copyAsHtmlCode');
  featureAssert((await bridge.invoke('clipboard.read')).includes('<strong>Bold</strong>'), 'HTML copy did not produce HTML');
  passed.push('Plain, Markdown and HTML clipboard actions produce distinct correct content');

  editor.setValue('- [ ] first\n- [x] second\n\nAfter'); cursor('first');
  await api.runAction('taskDone'); featureAssert(editor.value.startsWith('- [x] first'), 'Task done did not change checkbox');
  await api.runAction('taskTodo'); featureAssert(editor.value.startsWith('- [ ] first'), 'Task todo did not reset checkbox');
  editor.setValue('```java\nclass Demo {\nString text = "}";\nvoid run() {\ncall();\n}\n}\n```'); cursor('class Demo');
  await api.runAction('prettifyCode');
  featureAssert(editor.value.includes('\n    String text = "}";\n    void run() {\n        call();'), 'Java reindent counted braces inside strings');
  await api.runAction('copyCode'); featureAssert(!(await bridge.invoke('clipboard.read')).includes('```'), 'Copy code included delimiters');
  passed.push('Task status and code reindent/copy operate on the actual Markdown');

  editor.setValue('Before\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\nAfter'); cursor('Name');
  await api.runAction('copyTable'); featureAssert((await bridge.invoke('clipboard.readRich')).html.includes('<table>'), 'Copy table omitted rich HTML');
  const tableCell = document.querySelector<HTMLElement>('.md-table-widget th')!; tableCell.focus();
  await api.runAction('selectAll'); featureAssert(window.getSelection()?.toString() === 'Name', 'Select All in a table cell selected the document');
  await api.runAction('strong'); featureAssert(editor.value.includes('**Name**'), 'Format menu did not apply to the selected table cell');
  await api.runAction('deleteTable'); featureAssert(!editor.value.includes('|') && editor.value.includes('Before') && editor.value.includes('After'), 'Delete table removed adjacent content');
  editor.setValue('Text'); cursor('Text'); await api.runAction('insertFootnote');
  featureAssert(editor.value.includes('[^1]') && editor.value.includes('[^1]: '), 'Footnote did not create reference and definition');
  editor.setValue('Warning text'); cursor('Warning'); await api.runAction('alert:warning');
  featureAssert(editor.value === '> [!WARNING]\n> Warning text', 'Alert did not wrap the current paragraph');
  passed.push('Table clipboard/deletion, footnotes and alerts preserve document structure');

  for (const reverse of [false, true]) {
    for (const [action, source, expected] of [
      ['heading:1', 'alpha\nbeta\ngamma', '# alpha\nbeta\ngamma'],
      ['insertQuote', 'alpha\nbeta\ngamma', '> alpha\nbeta\ngamma'],
      ['insertUnorderedList', 'alpha\nbeta\ngamma', '- alpha\nbeta\ngamma'],
      ['insertOrderedList', 'alpha\nbeta\ngamma', '1. alpha\nbeta\ngamma'],
      ['insertTaskList', 'alpha\nbeta\ngamma', '- [ ] alpha\nbeta\ngamma'],
      ['taskDone', '- [ ] alpha\n- [ ] beta', '- [x] alpha\n- [ ] beta'],
    ]) {
      editor.setValue(source); const end = source.indexOf('\n') + 1;
      editor.view.dispatch({ selection: reverse ? { anchor: end, head: 0 } : { anchor: 0, head: end } });
      await api.runAction(action);
      featureAssert(editor.value === expected, action + ' modified the unselected next line: ' + editor.value);
      await api.runAction('undo'); featureAssert(editor.value === source, action + ' did not undo in one step');
    }
  }
  editor.setValue('alpha\nbeta'); editor.view.dispatch({ selection: { anchor: 6 } });
  await api.runAction('insertQuote'); featureAssert(editor.value === 'alpha\n> beta', 'Collapsed caret at line start was excluded');
  editor.setValue('alpha\nbeta'); editor.view.dispatch({ selection: { anchor: 0, head: 7 } });
  await api.runAction('insertQuote'); featureAssert(editor.value === '> alpha\n> beta', 'Partly selected final line was excluded');
  passed.push('Paragraph, list and task commands respect forward/reverse selection line boundaries and undo');

  const originalFile = api.state.file;
  await bridge.invoke('setting.put', 'actionWhenInsertImage', 'assets');
  await bridge.invoke('setting.put', 'applyRulesToLocal', true);
  await bridge.invoke('setting.put', 'relativePathWithDot', true);
  editor.setValue('Images\n\n'); cursor('Images');
  await api.runAction('insertLocalImages');
  featureAssert(editor.value.includes('assets/reference.png'), 'Local-image rule did not copy to assets');
  const id = await bridge.invoke('document.saveDraft', originalFile, 'RECOVERED_CONTENT', 'utf-8');
  featureAssert((await bridge.invoke('document.getDraft', id)).content === 'RECOVERED_CONTENT', 'Recovery did not persist content');
  passed.push('Image insertion copies real files, and recovery drafts round-trip through disk');
  editor.setValue('![space](reference%20space.png)');
  const spacedImage = new DOMParser().parseFromString(await api.prepareExport(), 'text/html').querySelector('img');
  featureAssert(spacedImage?.src.startsWith('data:image/png'), 'Escaped image filename was double-encoded during preview/export');
  editor.setValue('<img src="' + originalFile.replace(/[^\\/]+$/, 'reference%20space.png') + '" alt="absolute" width="120" />');
  const absoluteImage = new DOMParser().parseFromString(await api.prepareExport(), 'text/html').querySelector('img');
  featureAssert(absoluteImage?.src.startsWith('data:image/png'), 'Absolute HTML image path was joined to the document directory');
  editor.setValue('AUTOMATIC_DRAFT_BACKUP');
  await new Promise((resolve) => setTimeout(resolve, 1700));
  const automatic = await bridge.invoke('document.listDrafts');
  featureAssert(automatic.some((draft: { content: string }) => draft.content === 'AUTOMATIC_DRAFT_BACKUP'), 'Editing did not automatically back up a draft');
  await bridge.invoke('document.activate', null);
  const untitledA = await bridge.invoke('document.saveDraft', null, 'first', 'utf-8');
  await bridge.invoke('document.activate', null);
  const untitledB = await bridge.invoke('document.saveDraft', null, 'second', 'utf-8');
  featureAssert(untitledA !== untitledB && (await bridge.invoke('document.getDraft', untitledA)).content === 'first', 'New untitled documents overwrote each other’s drafts');
  await bridge.invoke('document.activate', originalFile);
  passed.push('Editing automatically backs up drafts and distinct untitled documents keep separate recovery records');
  await api.runAction('openFolder', originalFile.replace(/[/\\][^/\\]+$/, ''));
  await api.runAction('showFileList');
  featureAssert(!document.querySelector('#file-library-tree .file-tree-node') && Array.from(document.querySelectorAll<HTMLElement>('[data-path]')).some(node => node.dataset.path?.replace(/\\/g, '/').endsWith('/nested/child.md')), 'File list did not flatten nested Markdown files');
  await api.runAction('showFileTree');
  featureAssert(document.querySelector('#file-library-tree .file-tree-node'), 'File tree did not restore folder hierarchy');
  editor.setValue('FIELD_UNDO_BODY'); editor.view.dispatch({ selection: { anchor: 0, head: editor.value.length } });
  await api.runAction('strong'); const formatted = editor.value;
  await api.runAction('find');
  const commandInput = document.getElementById('search-panel-input') as HTMLInputElement;
  const modifier = /Mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
  commandInput.value = 'alpha'; commandInput.dispatchEvent(new Event('input'));
  commandInput.setSelectionRange(2, 2);
  if (/Mac/i.test(navigator.platform)) {
    const controlA = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    commandInput.dispatchEvent(controlA);
    featureAssert(!controlA.defaultPrevented && commandInput.selectionStart === 2, 'Mac Control-A was replaced with Command-A behavior');
  }
  const composingSelect = new KeyboardEvent('keydown', { key: 'a', ...modifier, isComposing: true, bubbles: true, cancelable: true });
  commandInput.dispatchEvent(composingSelect);
  featureAssert(!composingSelect.defaultPrevented && commandInput.selectionStart === 2, 'Query Select All interrupted an active composition');
  commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ...modifier, bubbles: true, cancelable: true }));
  featureAssert(commandInput.selectionStart === 0 && commandInput.selectionEnd === 5 && editor.value === formatted, 'Find-field Select All selected the document or failed to select the query');
  commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ...modifier, bubbles: true, cancelable: true }));
  await featureWait(() => editor.value === 'FIELD_UNDO_BODY' && editor.view.dom.contains(document.activeElement));
  featureAssert(commandInput.value === 'alpha', 'Document undo rewrote the find query');
  commandInput.focus(); commandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', shiftKey: true, ...modifier, bubbles: true, cancelable: true }));
  await featureWait(() => editor.value === formatted && editor.view.dom.contains(document.activeElement));
  await api.runAction('searchFolder');
  const folderCommandInput = document.getElementById('file-library-search-input') as HTMLInputElement;
  folderCommandInput.value = 'folder query'; folderCommandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ...modifier, bubbles: true, cancelable: true }));
  featureAssert(folderCommandInput.selectionStart === 0 && folderCommandInput.selectionEnd === 12 && editor.value === formatted, 'Sidebar query Select All failed or changed the document');
  folderCommandInput.value = ''; folderCommandInput.dispatchEvent(new Event('input')); await api.runAction('showFileTree');
  passed.push('Find and sidebar inputs select their own text, while find Undo/Redo returns focus and history to the document');
  editor.setValue('cat scatter cat'); await api.runAction('find');
  const search = document.getElementById('search-panel-input') as HTMLInputElement;
  search.value = 'cat'; search.dispatchEvent(new Event('input'));
  featureAssert(document.getElementById('search-panel-status')?.textContent === '1 / 3', 'Normal search lost a partial match or current-result count');
  featureAssert(document.activeElement === search, 'Searching stole focus from the query field');
  featureAssert(getComputedStyle(document.querySelector('.ty-replace-panel-row')!).display === 'none', 'Find mode showed replacement controls');
  document.getElementById('searchpanel-word-option-btn')!.click();
  featureAssert(document.getElementById('search-panel-status')?.textContent === '1 / 2', 'Whole-word search still matched inside another word');
  document.getElementById('search-panel-next')!.click();
  featureAssert(document.getElementById('search-panel-status')?.textContent === '2 / 2', 'Search navigation did not update its current-result count');
  const mode = document.getElementById('search-panel-mode') as HTMLSelectElement;
  mode.value = 'replace'; mode.dispatchEvent(new Event('change'));
  featureAssert(document.body.classList.contains('search-replace-open') && getComputedStyle(document.querySelector('.ty-replace-panel-row')!).display !== 'none', 'Replace mode did not open its second toolbar row');
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = 'dog';
  document.getElementById('search-panel-replaceall-btn')!.click();
  featureAssert(editor.value === 'dog scatter dog', 'Replace All missed separated whole-word matches');
  await api.runAction('undo'); featureAssert(editor.value === 'cat scatter cat', 'Replace All cannot undo as one document action');
  document.getElementById('search-panel-close')!.click();
  featureAssert(!document.body.classList.contains('search-open'), 'Closing search left reserved toolbar space');
  passed.push('File list/tree, search toolbar modes, focus, whole-word counts and replace-all undo');

  const openTableImageMenu = async () => {
    await featureWait(() => !!document.querySelector('.md-table-image-preview img'));
    const other = document.querySelector<HTMLElement>('td[data-col="1"]')!; other.focus();
    const selection = document.createRange(); selection.selectNodeContents(other.querySelector('.cm-md-strong') || other); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(selection);
    await new Promise(resolve => setTimeout(resolve, 30));
    const image = document.querySelector<HTMLElement>('.md-table-image-preview img')!;
    image.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    // Reproduce WebKit's native focus change between right mousedown and contextmenu.
    image.closest<HTMLElement>('td,th')!.focus();
    await new Promise(resolve => setTimeout(resolve, 30));
    image.dispatchEvent(new MouseEvent('contextmenu', { button: 2, clientX: 120, clientY: 120, bubbles: true, cancelable: true }));
    featureAssert(window.getSelection()?.toString() === 'other' && document.activeElement === other, 'Image right-click moved another cell selection');
    featureAssert(document.querySelector('#context-menu button[data-key="zoom-img"]') && document.querySelector('#context-menu button[data-key="table"]'), 'Table image menu lost image or table actions');
  };
  const imageMenuSource = '| A   | B |\n| :--- | ---: |\n| Before **bold** ![alt](sized.svg) after   | **other**  |\n\nTail';
  editor.setValue(imageMenuSource); await openTableImageMenu();
  document.querySelector<HTMLButtonElement>('#context-menu button[data-key="zoom-img"]')!.click();
  document.querySelector<HTMLButtonElement>('#zoom-img-menu button[data-key="image:zoom:50"]')!.click();
  await featureWait(() => editor.value.includes('zoom:50%'));
  const zoomedImage = '<img src="sized.svg" alt="alt" style="zoom:50%;" />';
  featureAssert(editor.value === imageMenuSource.replace('![alt](sized.svg)', zoomedImage), 'Image menu zoom rewrote table formatting or the wrong source');
  featureAssert(['50%', '0.5'].includes(document.querySelector<HTMLImageElement>('.md-table-image-preview img')?.style.zoom || '') && window.getSelection()?.toString() === zoomedImage, 'Menu zoom lost its preview or editable image source');
  await api.runAction('undo'); featureAssert(editor.value === imageMenuSource, 'Context image zoom cannot undo');
  await openTableImageMenu(); document.querySelector<HTMLButtonElement>('#context-menu button[data-key="switch-img-syntax"]')!.click();
  document.querySelector<HTMLButtonElement>('#switch-img-syntax-menu button[data-key="image:html"]')!.click();
  await featureWait(() => editor.value.includes('<img '));
  featureAssert(editor.value === imageMenuSource.replace('![alt](sized.svg)', '<img src="sized.svg" alt="alt" />'), 'Image menu syntax conversion damaged surrounding cells');
  await api.runAction('undo'); featureAssert(editor.value === imageMenuSource, 'Context image syntax conversion cannot undo');
  passed.push('Table image context menu preserves right-click selection, offers image/table tools and applies local zoom/syntax changes with undo');

  const fixtureDir = originalFile.replace(/[^/\\]+$/, '');
  for (const move of [false, true]) {
    const name = move ? 'menu-move.svg' : 'menu-copy.svg', contents = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>';
    await bridge.invoke('fs.writeText', fixtureDir + name, contents, 'utf-8');
    const source = '| A   | B |\n| :--- | ---: |\n| Before ![copy](' + name + ') after   | other  |\n\nTail';
    editor.setValue(source); await openTableImageMenu();
    const selector = '#context-menu button[data-key="' + (move ? 'move-img-to-target' : 'copy-img-to-target') + '"]';
    await featureWait(() => !!document.querySelector(selector)); document.querySelector<HTMLButtonElement>(selector)!.click();
    await featureWait(() => /!\[copy\]\([^)]*assets\//.test(editor.value));
    const updated = /!\[copy\]\(([^)]+)\)/.exec(editor.value)![1];
    featureAssert(editor.value === source.replace('(' + name + ')', '(' + updated + ')'), 'File transfer changed neighboring cell source');
    featureAssert(window.getSelection()?.toString() === 'other', 'Asynchronous file transfer stole the preserved selection');
    featureAssert((await bridge.invoke('fs.readText', fixtureDir + updated, 'utf-8')).content === contents, 'Image transfer did not copy real image contents');
    featureAssert(await bridge.invoke('fs.exists', fixtureDir + name) === !move, 'Copy/move did not retain/remove its original fixture file');
  }
  passed.push('Table image copy/move-to-assets commands transfer real files and update only their own references without stealing selection');

  const mediaSearchSource = '# Search heading\n\nBefore ![alt](reference.png) after.\n\n| Kind | Content |\n| --- | --- |\n| image | Before **bold** ![alt](reference.png) after |\n| HTML | <img src="reference.png" width="60" height="30"> |\n| escaped | left \\| Needle<br>Needle tail |\n| complex | <span>Needle</span> |\n\n[figure]: reference.png\n\nTail';
  editor.setValue(mediaSearchSource); await api.runAction('find');
  for (const button of document.querySelectorAll<HTMLElement>('.searchpanel-search-option-btn.active')) button.click();
  search.value = 'reference'; search.dispatchEvent(new Event('input'));
  featureAssert(document.getElementById('search-panel-status')?.textContent === '1 / 4', 'Media search missed a source URL');
  featureAssert(document.querySelector('.cm-inline-image-source .cm-search-hit') && document.querySelectorAll('.md-table-widget .cm-inline-image-source.cm-search-hit').length === 2, 'Search did not open and highlight all matching image sources');
  featureAssert(document.querySelectorAll('.md-table-image-preview img').length === 2 && document.activeElement === search, 'Media search lost previews or query focus');
  featureAssert(Array.from(document.querySelectorAll('.md-table-widget .cm-inline-image-source')).filter(node => !['none', 'normal', '""'].includes(getComputedStyle(node, '::before').content)).length === 2, 'Highlight fragments duplicated the image source icon');
  document.getElementById('search-panel-next')!.click();
  featureAssert(document.querySelector('.md-table-widget .cm-search-hit.is-current')?.textContent === 'reference', 'Navigation did not mark the current table match');
  document.getElementById('search-panel-close')!.click();
  const matchingCell = document.activeElement as HTMLElement;
  featureAssert(matchingCell.matches('td[data-row]') && window.getSelection()?.toString() === 'reference', 'Closing search did not restore the matching cell selection');
  featureAssert(!document.querySelector('.cm-search-hit') && editor.value === mediaSearchSource, 'Closing search left highlights or changed Markdown');
  const replacement = new DataTransfer(); replacement.setData('text/plain', 'updated');
  matchingCell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: replacement, bubbles: true, cancelable: true }));
  featureAssert(editor.value === mediaSearchSource.replace('**bold** ![alt](reference.png)', '**bold** ![alt](updated.png)'), 'Editing the restored cell modified the wrong source');
  await api.runAction('undo'); featureAssert(editor.value === mediaSearchSource, 'Restored table selection lost document undo');
  await api.runAction('find'); search.value = 'Needle'; search.dispatchEvent(new Event('input'));
  const escapedCell = document.querySelector<HTMLElement>('td[data-row="3"][data-col="1"]')!;
  featureAssert(Array.from(escapedCell.querySelectorAll('.cm-search-hit')).map(node => node.textContent).join('|') === 'Needle|Needle', 'Escaped pipes or HTML line breaks shifted table search offsets');
  featureAssert(document.querySelector('td[data-row="4"] .cm-search-hit')?.textContent === 'Needle', 'Fallback HTML cell did not expose its matching source');
  search.value = 'bold'; search.dispatchEvent(new Event('input'));
  featureAssert(document.querySelector('.md-table-widget .cm-md-strong.cm-search-hit')?.textContent === 'bold' && !document.querySelector('.md-table-widget .cm-md-marker'), 'Searching formatted text unnecessarily exposed its Markdown markers');
  document.getElementById('search-panel-close')!.click();
  await api.runAction('findNext');
  featureAssert(!document.querySelector('.cm-search-hit') && window.getSelection()?.toString() === 'bold', 'Find Next with the toolbar closed left persistent highlights or lost its cell selection');
  passed.push('Search exposes all media matches, preserves previews and focus, maps table escapes and restores editable cell selections');

  editor.setValue('cat cat cat'); await api.runAction('replace'); search.value = 'cat'; search.dispatchEvent(new Event('input'));
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = 'cat';
  document.getElementById('search-panel-replace-btn')!.click();
  featureAssert(document.getElementById('search-panel-status')?.textContent === '2 / 3', 'Replace Current restarted at the first matching result');
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = 'dog';
  document.getElementById('search-panel-replaceall-btn')!.click();
  featureAssert(editor.value === 'dog dog dog' && !document.querySelector('.cm-search-hit'), 'Replace All left stale source highlights');
  await api.runAction('undo');
  await featureWait(() => document.getElementById('search-panel-status')?.textContent?.endsWith('/ 3') === true);
  featureAssert(document.querySelectorAll('.cm-search-hit').length === 3, 'Undo with the search toolbar open did not refresh result highlights');
  document.getElementById('search-panel-close')!.click();
  editor.setValue('dog cat'); await api.runAction('findNext');
  featureAssert(editor.view.state.selection.main.from === 4 && editor.view.state.selection.main.to === 7 && !document.querySelector('.cm-search-hit'), 'Find Next used stale offsets after editing with the toolbar closed');
  passed.push('Replace Current advances, while replace-all and undo refresh the open search toolbar and all highlights');

  editor.setValue('red12 blue34'); await api.runAction('replace');
  document.getElementById('searchpanel-regexp-option-btn')!.click();
  search.value = '(?<name>[a-z]+)(\\d+)'; search.dispatchEvent(new Event('input'));
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = '$<name>-$2-$&-$$';
  document.getElementById('search-panel-replace-btn')!.click();
  featureAssert(editor.value === 'red-12-red12-$ blue34', 'Regex replacement lost named/numbered groups, full match or literal dollar');
  editor.setValue('prefix:red suffix:blue'); search.value = '(?<=:)([a-z]+)'; search.dispatchEvent(new Event('input'));
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = '$1-$&';
  document.getElementById('search-panel-replaceall-btn')!.click();
  featureAssert(editor.value === 'prefix:red-red suffix:blue-blue', 'Replace All lost full-document lookbehind context');
  editor.setValue('😀a'); search.value = '(?=.)'; search.dispatchEvent(new Event('input'));
  featureAssert(document.getElementById('search-panel-status')?.textContent === '1 / 2', 'Zero-width regex got stuck inside a Unicode surrogate pair');
  (document.getElementById('search-panel-replace-input') as HTMLInputElement).value = '_';
  document.getElementById('search-panel-replace-btn')!.click();
  featureAssert(editor.value === '_😀a' && editor.view.state.selection.main.from === 3, 'Zero-width replacement did not advance past the Unicode character');
  search.value = '['; search.dispatchEvent(new Event('input'));
  featureAssert(!document.querySelector('.cm-search-hit'), 'Invalid regex left stale result highlights');
  document.getElementById('searchpanel-regexp-option-btn')!.click();
  document.getElementById('search-panel-close')!.click();
  passed.push('Regex replacements preserve capture groups and lookbehind, while zero-width Unicode matches advance safely');

  const footnoteSource = 'Before[^note] after.\n\n| A | B |\n| --- | --- |\n| table[^note] | other |\n\n[^note]: *Body* $x^2$ with ![image][figure], [reference][site] and <img src="sized.svg" alt="sized preview" width="120" style="zoom:50%;" />.\n\n[figure]: reference.png\n[site]: https://example.com/ "Title"\n\nTail';
  editor.setValue(footnoteSource); cursor('Tail');
  await featureWait(() => !!document.querySelector('.md-table-footnote'));
  const footnote = document.querySelector<HTMLElement>('.md-table-footnote')!, caret = editor.view.state.selection.main.head;
  footnote.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await featureWait(() => !!document.querySelector('.cm-footnote-tooltip .md-inline-math svg'));
  await featureWait(() => Array.from(document.querySelectorAll<HTMLImageElement>('.cm-footnote-tooltip img')).every(image => image.complete && image.naturalWidth > 0));
  const preview = document.querySelector<HTMLElement>('.cm-footnote-tooltip')!, sized = preview.querySelector<HTMLImageElement>('img[alt="sized preview"]')!;
  featureAssert(preview.querySelector('em')?.textContent === 'Body' && preview.querySelector('a')?.getAttribute('href') === 'https://example.com/', 'Production footnote preview lost formatting or reference context');
  featureAssert(Math.abs(sized.getBoundingClientRect().width - 60) < 1 && Math.abs(sized.getBoundingClientRect().height - 30) < 1, 'Footnote preview lost HTML image dimensions or zoom');
  featureAssert(editor.value === footnoteSource && editor.view.state.selection.main.head === caret, 'Footnote preview moved the caret or changed source');
  const exportedFootnote = await api.prepareExport();
  featureAssert(exportedFootnote.includes('footnote-item') && exportedFootnote.includes('data:image/png') && !exportedFootnote.includes('cm-footnote-tooltip'), 'A live hover preview polluted the exported document');
  footnote.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); featureAssert(!document.querySelector('.cm-footnote-tooltip'), 'Production tooltip did not close');
  passed.push('Footnote hover renders real SVG math and local/reference images with dimensions while preserving selection and clean export');

  const source = '# Conversion heading\n\nCONVERSION_BODY\n\n| A | B |\n| --- | --- |\n| one | two |\n\n$x^2 + y^2$\n\n![reference](reference.png)\n\n<img src="sized.svg" alt="HTML-sized" width="120" style="zoom:50%;" />\n\n```mermaid\ngraph LR\n  A[Start] --> B[End]\n```\n\nCONVERSION_TAIL';
  editor.setValue(source); cursor('graph LR');
  for (const format of ['docx', 'odt', 'epub', 'latex', 'rtf', 'mediawiki', 'rst', 'textile', 'opml']) {
    const success = await api.runAction('export:' + format);
    featureAssert(success !== false, format + ' export failed: ' + document.getElementById('md-notification')?.textContent);
  }
  passed.push('Nine Pandoc export actions complete with rendered Mermaid while its code is active');

  // Hidden native export windows can temporarily change Windows' active window.
  // Synthetic DOM clicks do not perform the OS activation that a real click does.
  await bridge.invoke('window.focus');
  await featureWait(() => document.hasFocus());
  await api.runAction('showFileList');
  featureAssert(document.querySelector('.file-list-card .file-card-extension')?.textContent === '.md' && Array.from(document.querySelectorAll('.file-card-preview')).some(node => node.textContent?.includes('Nested document')), 'Document list lost extensions or real file summaries');
  document.getElementById('sidebar-menu-btn')!.click();
  await featureWait(() => document.getElementById('sidebar-menu-btn')?.getAttribute('aria-expanded') === 'true');
  featureAssert(document.querySelector('#sidebar-actions-menu [data-folder]'), 'Folder menu omitted recent directories');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  featureAssert(document.getElementById('sidebar-actions-menu')!.hidden && document.activeElement?.id === 'sidebar-menu-btn', 'Escape did not close the folder menu and restore its button');
  const toolbar = document.getElementById('ty-sidebar-footer')!;
  // Synthetic key events do not change WebKit's native input modality.
  const revealToolbar = document.activeElement!.matches(':focus-visible') || document.getElementById('aropyt-sidebar')!.matches(':hover');
  await featureWait(() => revealToolbar ? Number(getComputedStyle(toolbar).opacity) > .99 : Number(getComputedStyle(toolbar).opacity) < .01);
  featureAssert(getComputedStyle(toolbar).visibility === 'visible', 'Toolbar controls became inaccessible to keyboard navigation');
  document.getElementById('sidebar-folder-btn')!.click();
  await featureWait(() => !document.getElementById('sidebar-actions-menu')!.hidden);
  document.querySelector<HTMLButtonElement>('#sidebar-actions-menu [data-sort="modified"]')!.click();
  await featureWait(async () => document.getElementById('sidebar-actions-menu')!.hidden && await bridge.invoke('setting.get', 'sidebarSort') === 'modified');
  featureAssert(await bridge.invoke('setting.get', 'sidebarSort') === 'modified', 'File sorting was not persisted');
  await bridge.invoke('fs.writeText', fixtureDir + 'sidebar-refreshed.md', '# Refresh heading\n\nRefresh summary', 'utf-8');
  document.getElementById('sidebar-menu-btn')!.click();
  await featureWait(() => !document.getElementById('sidebar-actions-menu')!.hidden);
  const refresh = Array.from(document.querySelectorAll<HTMLButtonElement>('#sidebar-actions-menu button')).find(node => ['刷新', 'Refresh'].includes(node.textContent || ''))!;
  refresh.click();
  await featureWait(() => Array.from(document.querySelectorAll<HTMLElement>('.file-list-card')).some(node => node.dataset.path?.endsWith('/sidebar-refreshed.md') && node.textContent?.includes('Refresh summary')));
  document.getElementById('switch-file-list-btn')!.click();
  await featureWait(() => !!document.querySelector('#file-library-tree .file-tree-node'));
  document.getElementById('switch-file-list-btn')!.click();
  await featureWait(() => !!document.querySelector('.file-list-card'));
  await bridge.invoke('setting.addRecentFolder', fixtureDir + 'nested');
  document.getElementById('sidebar-menu-btn')!.click();
  await featureWait(() => !document.getElementById('sidebar-actions-menu')!.hidden);
  Array.from(document.querySelectorAll<HTMLButtonElement>('#sidebar-actions-menu [data-folder]')).find(node => node.dataset.folder === fixtureDir + 'nested')!.click();
  await featureWait(() => api.state.folder === fixtureDir + 'nested' && document.getElementById('sidebar-footer-main-item-label')?.textContent === 'nested');
  await api.runAction('openFolder', fixtureDir.replace(/[/\\]$/, ''));
  document.getElementById('sidebar-menu-btn')!.click();
  await featureWait(() => !document.getElementById('sidebar-actions-menu')!.hidden);
  document.querySelector<HTMLButtonElement>('#sidebar-actions-menu [data-sort="name"]')!.click();
  await featureWait(async () => document.getElementById('sidebar-actions-menu')!.hidden && await bridge.invoke('setting.get', 'sidebarSort') === 'name');
  document.getElementById('sidebar-menu-btn')!.click();
  await featureWait(() => !document.getElementById('sidebar-actions-menu')!.hidden);
  document.querySelector<HTMLButtonElement>('#sidebar-actions-menu [data-sort="descending"]')!.click();
  await featureWait(() => {
    const names = Array.from(document.querySelectorAll<HTMLElement>('.file-list-card')).map(node => node.dataset.path!.replace(/.*[/\\]/, ''));
    return document.getElementById('sidebar-actions-menu')!.hidden && names.length > 2 && names.every((name, index) => !index || names[index - 1].localeCompare(name, undefined, { numeric: false }) >= 0);
  });
  const sortedNames = Array.from(document.querySelectorAll<HTMLElement>('.file-list-card')).map(node => node.dataset.path!.replace(/.*[/\\]/, ''));
  featureAssert(sortedNames.every((name, index) => !index || sortedNames[index - 1].localeCompare(name, undefined, { numeric: false }) >= 0), 'Descending filename sort did not reorder the real document cards');
  passed.push('Sidebar folder menus expose recent folders, persist sorting, refresh real previews and switch list/tree from the bottom toolbar');

  const side = document.getElementById('aropyt-sidebar')!, tabs = document.getElementById('sidebar-tabs')!;
  const filesTab = document.getElementById('sidepanel-segmented-input-files')!;
  filesTab.click();
  const ordinaryScroll = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });
  document.getElementById('file-library')!.dispatchEvent(ordinaryScroll);
  featureAssert(api.state.panel === 'files' && !ordinaryScroll.defaultPrevented, 'Ordinary downward file scrolling was replaced with search');
  tabs.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true }));
  featureAssert(api.state.panel === 'search' && !document.getElementById('sidebar-search-btn')!.hidden && document.getElementById('sidepanel-segmented-input-outline')!.hidden, 'Scrolling down on the tab strip did not reveal the Search tab');
  await featureWait(() => document.getElementById('sidebar-search-reveal')!.getBoundingClientRect().height > 30);
  const folderInput = document.getElementById('file-library-search-input') as HTMLInputElement;
  featureAssert(document.activeElement === folderInput, 'Revealing folder search did not focus the query');
  folderInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  featureAssert(api.state.panel === 'files' && document.getElementById('sidebar-search-reveal')!.inert && document.activeElement === filesTab, 'Escape did not restore Files and make the collapsed search controls inert');
  document.getElementById('sidebar-content')!.scrollTop = 0;
  side.dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true, cancelable: true }));
  featureAssert(api.state.panel === 'search', 'Pulling down at the top did not reveal folder search');
  await featureWait(() => document.getElementById('sidebar-search-reveal')!.getBoundingClientRect().height > 30);
  const optionBox = document.querySelector<HTMLElement>('.sidebar-search-options')!;
  const caseButton = document.getElementById('sidebar-search-case')!;
  caseButton.focus();
  featureAssert(document.activeElement === caseButton, 'Search option could not receive focus after reveal: ' + document.activeElement?.id);
  await featureWait(() => Number(getComputedStyle(optionBox).opacity) > .99);
  featureAssert(getComputedStyle(optionBox).pointerEvents === 'auto', 'Keyboard focus could not expose the hover search options');
  featureAssert(parseFloat(getComputedStyle(folderInput).paddingRight) >= 68, 'Visible search options covered query text');
  folderInput.focus();
  if (!document.querySelector('.sidebar-search-field')!.matches(':hover')) await featureWait(() => Number(getComputedStyle(optionBox).opacity) < .01);
  passed.push('Sidebar starts with Files/Outline, reveals search from header/top scrolling, preserves file scrolling and supports Escape and keyboard options');

  const folderFixture = fixtureDir + 'sidebar-search-options.md';
  await bridge.invoke('fs.writeText', folderFixture, 'AropytCaseToken\naropytcasetoken\nprefixaropytcasetokensuffix\naropytcasetoken42\n', 'utf-8');
  const resultBox = document.getElementById('file-library-search-result')!;
  const queryFolder = (query: string) => { folderInput.value = query; folderInput.dispatchEvent(new Event('input')); };
  const resultCount = () => resultBox.querySelectorAll('.ty-search-item-match').length;
  const waitResults = (count: number) => featureWait(() => resultBox.getAttribute('aria-busy') === 'false' && resultCount() === count);
  queryFolder('aropytcasetoken'); await waitResults(4);
  caseButton.click(); await waitResults(3);
  document.getElementById('sidebar-search-word')!.click(); await waitResults(1);
  document.getElementById('sidebar-search-regex')!.click();
  queryFolder('^aropytcasetoken\\d+$'); await waitResults(1);
  featureAssert(resultBox.textContent?.includes('aropytcasetoken42') && document.activeElement === folderInput, 'Folder regex toggles lost their actual match or query focus');
  document.getElementById('sidebar-search-regex')!.click(); await waitResults(0);
  for (const id of ['sidebar-search-case', 'sidebar-search-word']) document.getElementById(id)!.click();
  const originalFolderInvoke = bridge.invoke;
  let releaseOldSearch!: (value: unknown) => void;
  bridge.invoke = (method: string, ...args: unknown[]) => method === 'search.findAll' && args[1] === 'OLD_FOLDER_QUERY' ? new Promise(resolve => { releaseOldSearch = resolve; }) : originalFolderInvoke(method, ...args);
  try {
    queryFolder('OLD_FOLDER_QUERY'); queryFolder('FOLDER_NO_MATCH'); await waitResults(0);
    releaseOldSearch([{ file: folderFixture, line: 0, text: 'STALE_SEARCH_RESULT' }]);
    await new Promise(requestAnimationFrame);
    featureAssert(resultCount() === 0 && !resultBox.textContent?.includes('STALE_SEARCH_RESULT'), 'A delayed folder search overwrote the current query');
  } finally { bridge.invoke = originalFolderInvoke; }
  queryFolder(''); await waitResults(0);
  passed.push('Sidebar case, whole-word and regex switches filter real files independently, keep focus and reject stale search results');

  document.getElementById('sidebar-search-btn')!.click();
  featureAssert(document.activeElement?.id === 'file-library-search-input', 'Sidebar search did not focus its input');
  await featureWait(() => document.getElementById('aropyt-sidebar')!.matches(':hover') || Number(getComputedStyle(toolbar).opacity) < .01);
  if (!document.getElementById('aropyt-sidebar')!.matches(':hover')) featureAssert(getComputedStyle(toolbar).pointerEvents === 'none', 'Search focus kept the hover-only toolbar visible or clickable');
  const previousWidth = document.documentElement.style.getPropertyValue('--sidebar-width');
  document.body.classList.add('sidebar-resizing');
  for (const width of [140, 460]) {
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    const side = document.getElementById('aropyt-sidebar')!.getBoundingClientRect(), input = document.querySelector('.sidebar-search-field')!.getBoundingClientRect();
    featureAssert(Math.abs(input.left - side.left - 16) < 1 && Math.abs(side.right - input.right - 17) < 1, 'Sidebar search did not resize with equal insets: ' + JSON.stringify({ side: side.toJSON(), input: input.toJSON() }));
  }
  document.documentElement.style.setProperty('--sidebar-width', previousWidth); document.body.classList.remove('sidebar-resizing');
  const spell = document.querySelector('#footer-spell-check .ty-spellcheck')!;
  featureAssert(!!spell && getComputedStyle(spell, '::before').content !== 'none' && getComputedStyle(spell).display !== 'none' && document.getElementById('footer-spell-check')!.title.match(/禁用|Disabled/), 'Disabled spelling lost its A/check glyph or state tooltip');
  passed.push('Sidebar search adapts to narrow and wide panels, and disabled spelling retains its complete icon and tooltip');

  document.getElementById('sidebar-new-file-btn')!.click();
  await featureWait(() => !!document.getElementById('sidebar-new-file-row'));
  const name = document.querySelector<HTMLInputElement>('#sidebar-new-file-row input')!;
  const nameRect = name.getBoundingClientRect(), scrollRect = document.getElementById('sidebar-content')!.getBoundingClientRect();
  featureAssert(nameRect.top >= scrollRect.top && nameRect.bottom <= document.getElementById('ty-sidebar-footer')!.getBoundingClientRect().top, 'Floating toolbar covered the inline file-name input');
  const submitName = (value: string) => { name.value = value; name.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
  submitName('../outside');
  featureAssert(document.querySelector('#sidebar-new-file-row [role="alert"]')!.textContent, 'New file allowed a path outside the current folder');
  submitName('sidebar-cancelled');
  await featureWait(() => !name.disabled);
  featureAssert(!(await bridge.invoke('fs.exists', fixtureDir + 'sidebar-cancelled.md')) && editor.value === source, 'Cancelling the dirty-document prompt created a file or discarded the document');
  const previousInvoke = bridge.invoke;
  try {
    bridge.invoke = async (method: string, ...args: unknown[]) => method === 'dialog.showMessageBox' ? { response: 1 } : previousInvoke(method, ...args);
    submitName('sidebar-refreshed.md');
    await featureWait(() => !name.disabled);
    featureAssert(document.querySelector('#sidebar-new-file-row [role="alert"]')!.textContent && (await bridge.invoke('fs.readText', fixtureDir + 'sidebar-refreshed.md')).content.includes('Refresh summary'), 'New file overwrote an existing document');
    submitName('sidebar-created');
    await featureWait(() => api.state.file === fixtureDir + 'sidebar-created.md');
    featureAssert(editor.value === '' && (await bridge.invoke('fs.readText', api.state.file)).content === '', 'Inline new file did not open an empty Markdown file on disk');
    await featureWait(() => !document.getElementById('sidebar-new-file-row'));
    document.getElementById('sidebar-new-file-btn')!.click();
    await featureWait(() => !!document.querySelector('#sidebar-new-file-row input'));
    document.querySelector('#sidebar-new-file-row input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    featureAssert(!document.getElementById('sidebar-new-file-row') && document.activeElement?.id === 'sidebar-new-file-btn', 'Escape did not cancel inline file creation');
  } finally { bridge.invoke = previousInvoke; }
  api.state.file = originalFile; await bridge.invoke('document.activate', originalFile);
  passed.push('Inline sidebar creation validates names, preserves cancelled edits, refuses overwrite, creates real Markdown and cancels with Escape');
  return passed;
};
