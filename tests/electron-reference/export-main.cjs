const { app, BrowserWindow, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [root, work] = process.argv.slice(2);
app.setPath('userData', path.join(work, 'profile'));
fs.mkdirSync(path.join(work, 'profile/themes'), { recursive: true });
fs.writeFileSync(path.join(work, 'profile/themes/asset-test.css'), '@font-face{font-family:AssetCheck;src:url("' + path.join(root, 'vendor/styles/Raleway-latin.woff2') + '")}');
const comparison = path.join(root, 'release/comparison/aropyt-editing.md');
const source = fs.readFileSync(fs.existsSync(comparison) ? comparison : path.join(root, 'samples/editing.md'), 'utf8');
const file = path.join(work, 'aropyt-editing-fixed.md');
fs.writeFileSync(file, source);
fs.writeFileSync(path.join(work, 'reference.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="#e6edf5"/><text x="12" y="26" font-size="18">Reference</text></svg>');
process.argv.push(file);
const out = path.join(root, 'release/verification');
const pdfOut = path.join(root, 'output/pdf');
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(pdfOut, { recursive: true });
const counts = {};
dialog.showSaveDialog = async (_win, options) => {
  const ext = options.filters[0].extensions[0];
  const count = counts[ext] = (counts[ext] || 0) + 1;
  const names = { pdf: ['aropyt-editing-fixed.pdf'], html: ['aropyt-editing-fixed.html', 'rich-document.html', 'plain-document.html'], png: ['aropyt-editing-fixed.png', 'long-document.png'] };
  return { canceled: false, filePath: path.join(ext === 'pdf' ? pdfOut : out, names[ext][count - 1]) };
};
let printChecked = false;
app.on('web-contents-created', (_event, contents) => {
  contents.print = async (_options, callback) => {
    const correct = await contents.executeJavaScript("document.querySelectorAll('.md-diagram svg').length === 2 && document.body.innerText.includes('END_OF_DOCUMENT') && !document.querySelector('.cm-editor')");
    printChecked = correct;
    callback(correct, correct ? '' : 'Print document incomplete');
  };
});
let started = false;
app.on('browser-window-created', (_event, win) => {
  if (started) return; started = true;
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'dist/test/export.js'), 'utf8'));
      const passed = await win.webContents.executeJavaScript('window.runExportChecks()');
      for (const name of passed) console.log('PASS ' + name);
      const pdf = fs.readFileSync(path.join(pdfOut, 'aropyt-editing-fixed.pdf'));
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('Saved PDF is invalid');
      const short = nativeImage.createFromPath(path.join(out, 'aropyt-editing-fixed.png')).getSize();
      const long = nativeImage.createFromPath(path.join(out, 'long-document.png')).getSize();
      const scale = short.width / 1000;
      if (scale < 1 || long.width !== short.width || long.height / scale < short.height / scale + 1000)
        throw Error('PNG export dimensions do not cover the complete document: ' + JSON.stringify({ short, long, scale }));
      if (!printChecked) throw Error('Print was not checked');
      const check = new BrowserWindow({ width: 1000, height: 950, show: false, webPreferences: { sandbox: true } });
      await check.loadFile(path.join(out, 'rich-document.html'));
      const data = await check.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;const sized=document.querySelector('img[alt="HTML-size"]').getBoundingClientRect();return {diagrams:document.querySelectorAll('.md-diagram svg').length,math:!!document.querySelector('mjx-container svg'),image:Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0),width:document.querySelector('.md-diagram svg').getBoundingClientRect().width,sized:[sized.width,sized.height]}})()`);
      if (data.diagrams !== 2 || !data.math || !data.image || data.width < 50 || data.sized[0] !== 60 || data.sized[1] !== 20) throw Error('Standalone offline HTML did not render: ' + JSON.stringify(data));
      await check.loadFile(path.join(out, 'aropyt-editing-fixed.html'));
      await check.webContents.executeJavaScript('document.fonts.ready');
      fs.writeFileSync(path.join(out, 'html-offline-preview.png'), (await check.webContents.capturePage()).toPNG());
      check.destroy();
      console.log('PASS Reopened standalone HTML renders without document scripts');
      console.log('PASS PDF header, PNG full-document height and prepared print document verified');
      console.log('PDF: ' + path.join(pdfOut, 'aropyt-editing-fixed.pdf'));
      console.log('PNG sizes: ' + JSON.stringify({ short, long }));
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require(path.join(root, 'dist/main/index.js'));
