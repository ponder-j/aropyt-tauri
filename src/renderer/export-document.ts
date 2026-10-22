import { uiText } from '../shared/ui-language';
import { escapeHtml, renderDocument } from './md';

export interface ExportDocumentOptions {
  source: string;
  title: string;
  styles: string;
  resolveSrc: (src: string) => string;
  math: (tex: string, display: boolean) => string;
  diagram: (source: string) => Promise<string>;
  image: (src: string) => Promise<string>;
  preserveLineBreaks?: boolean;
  preserveWhitespace?: boolean;
}

/** Export from the complete Markdown, independent of the caret, source mode,
 * viewport or pending live-preview widgets. All diagrams are baked into SVG. */
export async function createExportDocument(options: ExportDocumentOptions): Promise<string> {
  const root = document.createElement('div');
  root.className = 'aropyt-export export-preparation';
  root.style.cssText = 'position:fixed;left:-100000px;top:0;width:860px;pointer-events:none';
  root.innerHTML = renderDocument(options.source, { math: options.math, resolveSrc: options.resolveSrc,
    preserveLineBreaks: options.preserveLineBreaks }).html;
  document.body.append(root);
  try {
    await document.fonts.ready;
    for (const diagram of root.querySelectorAll<HTMLElement>('.md-diagram')) {
      const source = diagram.querySelector('.md-diagram-pending')?.textContent ?? '';
      try { diagram.innerHTML = await options.diagram(source); }
      catch (error) { throw new Error(uiText('Mermaid 渲染失败：', 'Mermaid rendering failed: ') + String(error)); }
      diagram.dataset.rendered = '1';
    }
    for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
      const source = img.getAttribute('src') ?? '';
      const embedded = await options.image(source);
      if (typeof embedded !== 'string') throw new Error(uiText('无法读取导出图片：', 'Could not read image for export: ') + source);
      img.src = embedded;
    }
    if (root.querySelector('.md-math-fallback')) throw new Error(uiText('公式引擎尚未准备好，请重试导出', 'The math engine is not ready. Try exporting again.'));
    if (options.preserveWhitespace) {
      // The renderer's formatting newline after <br> must not become a second
      // visual break when paragraphs preserve spaces.
      for (const br of root.querySelectorAll('p br')) {
        if (br.nextSibling?.nodeType === Node.TEXT_NODE && br.nextSibling.textContent?.startsWith('\n')) br.nextSibling.textContent = br.nextSibling.textContent.slice(1);
      }
    }
    return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      `<title>${escapeHtml(options.title)}</title><style>${(options.styles + (options.preserveWhitespace ? '\n.aropyt-export #write p{white-space:pre-wrap}' : '')).replace(/<\/style/gi, '<\\/style')}</style></head>` +
      `<body class="aropyt-export">${root.innerHTML}</body></html>`;
  } finally { root.remove(); }
}
