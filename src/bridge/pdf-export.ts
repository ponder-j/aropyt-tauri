type PdfObjectType<T> = abstract new (...args: never[]) => T;

interface PdfDictionary {
  get(key: object): object | undefined;
  set(key: object, value: object): void;
}

interface PdfText {
  decodeText(): string;
}

interface PdfDocument {
  context: { lookup(value: object | undefined): object | undefined };
  getPages(): { node: { Annots(): { asArray(): object[] } | undefined } }[];
  saveAsBase64(): Promise<string>;
}

interface PdfLibrary {
  PDFDocument: { load(base64: string, options: { updateMetadata: boolean }): Promise<PdfDocument> };
  PDFDict: PdfObjectType<PdfDictionary>;
  PDFName: { of(name: string): object };
  PDFString: PdfObjectType<PdfText>;
  PDFHexString: PdfObjectType<PdfText> & { of(hex: string): object };
}

let pdfLibrary: Promise<PdfLibrary> | undefined;

function loadPdfLibrary(): Promise<PdfLibrary> {
  return pdfLibrary ??= new Promise<PdfLibrary>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      reject(new Error('Could not load the PDF library'));
    };
    script.src = '../../vendor/aropyt-lib/pdf/pdf-lib.min.js';
    script.onerror = fail;
    script.onload = () => {
      const library = (window as Window & { PDFLib?: PdfLibrary }).PDFLib;
      if (library) resolve(library);
      else fail();
    };
    document.head.append(script);
  }).catch(error => {
    pdfLibrary = undefined;
    throw error;
  });
}

export async function renderPdf(html: string, print: (html: string) => Promise<string>): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const token = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const targets = new Map<string, string>();

  // WebView2 resolves relative links against the export window's origin.
  // WKWebView can omit them altogether. Give both engines an absolute URL
  // for each such link, then restore the original URI in the PDF annotation.
  for (const link of doc.querySelectorAll('a[href], area[href], a[xlink\\:href]')) {
    const attr = link.hasAttribute('href') ? 'href' : 'xlink:href';
    const href = link.getAttribute(attr)!
      .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\r\n]/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) continue;
    const marker = `https://aropyt.invalid/${token}/${targets.size}`;
    targets.set(marker, href);
    link.setAttribute(attr, marker);
  }
  if (!targets.size) return print(html);

  const doctype = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) : '';
  const base64 = await print(doctype + doc.documentElement.outerHTML);
  const { PDFDocument, PDFDict, PDFName, PDFString, PDFHexString } = await loadPdfLibrary();
  const pdf = await PDFDocument.load(base64, { updateMetadata: false });
  const actionKey = PDFName.of('A');
  const uriKey = PDFName.of('URI');
  const encoder = new TextEncoder();
  let changed = false;
  for (const page of pdf.getPages()) {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      const annotation = pdf.context.lookup(ref);
      if (!(annotation instanceof PDFDict)) continue;
      const action = pdf.context.lookup(annotation.get(actionKey));
      if (!(action instanceof PDFDict)) continue;
      const uri = pdf.context.lookup(action.get(uriKey));
      if (!(uri instanceof PDFString || uri instanceof PDFHexString)) continue;
      const target = targets.get(uri.decodeText());
      if (target === undefined) continue;
      // PDF URI actions require ASCII. Preserve existing percent escapes.
      const ascii = target.replace(/[^\x21-\x7e]+/g, chars =>
        Array.from(encoder.encode(chars), byte => '%' + byte.toString(16).padStart(2, '0').toUpperCase()).join(''));
      action.set(uriKey, PDFHexString.of(Array.from(ascii, char => char.charCodeAt(0).toString(16)).join('')));
      changed = true;
    }
  }
  return changed ? pdf.saveAsBase64() : base64;
}
