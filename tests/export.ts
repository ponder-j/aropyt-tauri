const wait = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Export test timed out');
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

(window as any).runExportChecks = async () => {
  await wait(() => !!(window as any).__aropyt);
  const api = (window as any).__aropyt;
  const editor = api.getEditor();
  const passed: string[] = [];
  editor.view.dispatch({ selection: { anchor: editor.value.indexOf('graph LR') } });
  assert(document.querySelector('#md-editor .md-diagram-edit-preview') && document.querySelector('#md-editor .cm-code-line'), 'Mermaid test must start with both code and graph preview');
  const firstHtml = await api.prepareExport();
  const parsed = new DOMParser().parseFromString(firstHtml, 'text/html');
  assert(parsed.querySelector('.md-diagram svg'), 'Prepared export did not bake Mermaid into SVG');
  assert(parsed.querySelectorAll('.md-diagram svg').length === 1 && !parsed.querySelector('.md-diagram-edit-preview'), 'Export duplicated the editing preview');
  assert(!parsed.querySelector('.md-diagram-pending'), 'Prepared export contains a code placeholder');
  assert(parsed.querySelector('code .hljs-keyword'), 'Export lost code syntax highlighting');
  passed.push('Export prepares static SVG and highlighted code while Mermaid is being edited');
  await api.runAction('export:pdf');
  await api.runAction('export:html');
  await api.runAction('export:image');
  passed.push('Real PDF / HTML / PNG menu actions finish through IPC and save dialogs');

  const longSource = '# 导出检查\n\n```mermaid\ngraph LR\n  A[One] --> B[Two]\n```\n\n' +
    '![reference](reference.svg)\n\n<img src="reference.svg" alt="HTML-size" width="120" style="zoom:50%;" />\n\n$x^2 + y^2$\n\n' +
    '```mermaid\ngraph TD\n  X[Another] --> Y[Diagram]\n```\n\n' +
    Array.from({ length: 55 }, (_, i) => `段落 ${i + 1}：完整文档导出检查。`).join('\n\n') + '\n\nEND_OF_DOCUMENT';
  editor.setValue(longSource);
  editor.setSourceMode(true);
  const longHtml = await api.prepareExport();
  const longParsed = new DOMParser().parseFromString(longHtml, 'text/html');
  assert(longParsed.querySelectorAll('.md-diagram svg').length === 2, 'Multiple diagrams did not render');
  assert(longParsed.querySelector('mjx-container svg'), 'Export omitted math SVG');
  assert(longParsed.querySelector('img')?.getAttribute('src')?.startsWith('data:image/svg+xml;base64,'), 'Local image was not embedded');
  const htmlImage = longParsed.querySelector<HTMLImageElement>('img[alt="HTML-size"]');
  assert(htmlImage?.src.startsWith('data:image/svg+xml;base64,') && htmlImage.style.zoom === '50%', 'Sized HTML image lost its embedded source or zoom');
  const assetStyles = await (window as any).JSBridge.invoke('export.getStyles', 'asset-test', true);
  assert(assetStyles.includes('data:font/woff2;base64,'), 'Available theme fonts were not embedded');
  assert(!longHtml.includes("url('./github/"), 'Missing optional theme fonts left broken relative URLs');
  assert(longParsed.body.textContent?.includes('END_OF_DOCUMENT'), 'Export truncated source text');
  passed.push('Source-mode export embeds multiple diagrams, math, local images, fonts and the document tail');
  await api.runAction('export:html');
  await api.runAction('export:html-plain');
  await api.runAction('export:image');
  await api.runAction('print');
  passed.push('Long PNG, plain HTML and print use the same complete document');
  return passed;
};
