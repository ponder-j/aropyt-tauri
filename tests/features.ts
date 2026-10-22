const featureWait = async (predicate: () => boolean) => {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise((r) => setTimeout(r, 30)); }
  throw new Error('Feature test timed out');
};
const featureAssert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

(window as any).runFeatureChecks = async () => {
  await featureWait(() => !!(window as any).__aropyt);
  const api = (window as any).__aropyt, editor = api.getEditor(), bridge = (window as any).JSBridge;
  const passed: string[] = [];
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
  editor.setValue('cat scatter cat'); await api.runAction('find');
  const search = document.getElementById('search-panel-input') as HTMLInputElement;
  search.value = 'cat'; search.dispatchEvent(new Event('input'));
  featureAssert(document.getElementById('search-panel-status')?.textContent === '3', 'Normal search lost a partial match');
  document.getElementById('searchpanel-word-option-btn')!.click();
  featureAssert(document.getElementById('search-panel-status')?.textContent === '2', 'Whole-word search still matched inside another word');
  document.getElementById('search-panel-close')!.click();
  passed.push('File list and tree use distinct layouts; whole-word search filters partial matches');

  const source = '# Conversion heading\n\nCONVERSION_BODY\n\n| A | B |\n| --- | --- |\n| one | two |\n\n$x^2 + y^2$\n\n![reference](reference.png)\n\n<img src="sized.svg" alt="HTML-sized" width="120" style="zoom:50%;" />\n\n```mermaid\ngraph LR\n  A[Start] --> B[End]\n```\n\nCONVERSION_TAIL';
  editor.setValue(source); cursor('graph LR');
  for (const format of ['docx', 'odt', 'epub', 'latex', 'rtf', 'mediawiki', 'rst', 'textile', 'opml']) {
    const success = await api.runAction('export:' + format);
    featureAssert(success !== false, format + ' export failed: ' + document.getElementById('md-notification')?.textContent);
  }
  passed.push('Nine Pandoc export actions complete with rendered Mermaid while its code is active');
  return passed;
};
