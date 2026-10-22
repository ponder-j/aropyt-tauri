import { DocEditor, replaceSelection, wrapSelection, lineTransform } from './editor';
import { renderDocument } from './md';
import { formDialog, showText } from './dialogs';
import { blockAt, clearMarkdown, codeContent, linkAt, plainText, reindentCode, selectedMarkdown, rangeAction, setTaskStatus } from './editing-commands';

export interface ActionContext {
  editor: DocEditor;
  state: { file: string | null; folder: string | null; encoding: string; dirty: boolean; lang: string };
  settings: Record<string, any>;
  invoke: <T = any>(method: string, ...args: unknown[]) => Promise<T>;
  confirmSave: () => Promise<boolean>;
  exportHtml: (styled?: boolean) => Promise<string>;
  resolveImage: (source: string) => string;
  changed: (dirty?: boolean) => void;
  refresh: () => void;
  showPanel: (panel: 'outline' | 'files' | 'search') => void;
  refreshFiles: () => Promise<void>;
  notify: (text: string, kind?: 'info' | 'success' | 'error') => void;
}

const formats: [string, string][] = [['docx', 'Word (.docx)'], ['odt', 'OpenOffice (.odt)'], ['epub', 'Epub'], ['latex', 'LaTeX'],
  ['rtf', 'RTF'], ['mediawiki', 'MediaWiki'], ['rst', 'reStructuredText'], ['textile', 'Textile'], ['opml', 'OPML']];

export async function runExtraAction(action: string, arg: unknown, ctx: ActionContext): Promise<boolean> {
  const { editor, state, settings, invoke } = ctx;
  const write = (text: string, html = '') => invoke('clipboard.writeRich', text, html);
  const copy = (source: string, plain = false, rich = false) => write(plain ? plainText(source) : source,
    rich ? renderDocument(source).html : '');
  const setting = async (key: string, value: unknown) => { settings[key] = value; await invoke('setting.put', key, value); };
  const insert = (text: string) => { replaceSelection(editor, text); editor.focus(); };
  const show = (title: string, text: string) => showText(title, text);
  const selection = editor.view.state.selection.main;
  const prepareImages = (sources: string[]) => {
    const yaml = /^---\s*\n([\s\S]*?)\n---/.exec(editor.value)?.[1] || '';
    const forceUpload = settings.autoUploadByYaml && /^typora-copy-images-to:\s*['"]?upload['"]?\s*$/m.test(yaml);
    return invoke<string[]>('images.prepare', sources, state.file, !!forceUpload);
  };

  if (action.startsWith('export:') && formats.some(([key]) => action === 'export:' + key) || action === 'export:other') {
    let format = action.slice(7);
    if (format === 'other') {
      const result = await formDialog('导出', [{ name: 'format', label: '格式', type: 'select', value: 'rtf', options: formats }]);
      if (!result) return true; format = result.format;
    }
    const html = new DOMParser().parseFromString(await ctx.exportHtml(), 'text/html');
    const diagrams = Array.from(html.querySelectorAll('.md-diagram svg')).map((svg) => svg.outerHTML);
    const output = await invoke<string | null>('pandoc.export', { source: editor.value, format, file: state.file, diagrams });
    if (output) { ctx.notify('已导出：' + output, 'success'); if (settings.openAfterExport) await invoke('shell.showItemInFolder', output); }
    return true;
  }
  if (action.startsWith('alert:')) {
    const kind = action.slice(6).toUpperCase();
    if (!['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].includes(kind)) return false;
    const block = blockAt(editor);
    const text = selection.empty ? block?.text ?? '' : editor.view.state.sliceDoc(selection.from, selection.to);
    const value = `> [!${kind}]\n` + text.replace(/^>\s?\[!\w+\]\n/, '').split('\n').map((s) => '> ' + s.replace(/^>\s?/, '')).join('\n');
    if (selection.empty && block) editor.view.dispatch({ changes: { from: block.from, to: block.to, insert: value }, userEvent: 'input' }); else insert(value);
    editor.focus(); return true;
  }
  if (action.startsWith('lineEndings:')) { await setting('lineEndings', action.slice(12)); return true; }
  switch (action) {
    case 'exportSetting': await invoke('window.openPreferences', 'export'); return true;
    case 'import': {
      if (!(await ctx.confirmSave())) return true;
      const imported = await invoke<{ content: string; source: string } | null>('pandoc.import');
      if (imported) { state.file = null; state.encoding = 'utf-8'; editor.setValue(imported.content); await invoke('document.activate', null); ctx.changed(); }
      return true;
    }
    case 'moveTo': {
      if (!(await ctx.confirmSave())) return true;
      if (!state.file) { await show('移动文档', '请先保存文档。'); return true; }
      const result = await invoke<{ canceled: boolean; filePath?: string }>('dialog.showSaveDialog', { title: '移动文档', defaultPath: state.file });
      if (!result.canceled && result.filePath && result.filePath !== state.file) {
        await invoke('document.rename', state.file, result.filePath); state.file = result.filePath;
        await invoke('document.activate', state.file); ctx.changed(false); await ctx.refreshFiles();
      }
      return true;
    }
    case 'properties': {
      const metadata = await invoke<{ file: string | null; size?: number; created?: string; modified?: string }>('document.properties', state.file);
      await show('文档属性', [metadata.file || '未保存的文档', metadata.size === undefined ? '' : `大小：${metadata.size.toLocaleString()} 字节`,
        `编码：${state.encoding}`, `字符数：${editor.value.length}`, `行数：${editor.view.state.doc.lines}`,
        metadata.created ? '创建：' + new Date(metadata.created).toLocaleString() : '', metadata.modified ? '修改：' + new Date(metadata.modified).toLocaleString() : ''].filter(Boolean).join('\n'));
      return true;
    }
    case 'revealInSidebar': {
      if (state.file) { state.folder = state.file.replace(/[\\/][^\\/]+$/, ''); await ctx.refreshFiles(); }
      ctx.showPanel('files'); return true;
    }
    case 'deleteFile': {
      if (!state.file) { await show('删除文档', '此文档尚未保存到磁盘。'); return true; }
      const result = await invoke<{ response: number }>('dialog.showMessageBox', { type: 'warning', message: '将此文档移到废纸篓？', detail: state.file,
        buttons: ['移到废纸篓', '取消'], defaultId: 1, cancelId: 1 });
      if (result.response === 0) {
        await invoke('shell.trashItem', state.file); await invoke('setting.removeRecentDocument', state.file);
        state.file = null; editor.setValue(''); await invoke('document.activate', null); ctx.changed(false); await ctx.refreshFiles();
      }
      return true;
    }
    case 'copyAsMarkdown': await copy(selectedMarkdown(editor)); return true;
    case 'copyPlain': await copy(selectedMarkdown(editor), true); return true;
    case 'copyAsHtmlCode': await write(renderDocument(selectedMarkdown(editor)).html); return true;
    case 'copySimple': await copy(selectedMarkdown(editor), true, true); return true;
    case 'pasteAsPlain': await invoke('webContents.pastePlain'); return true;
    case 'copyImage': {
      const image = linkAt(editor); if (image?.image) await invoke('images.copyImage', ctx.resolveImage(image.href));
      else ctx.notify('请先选择文档中的图片。'); return true;
    }
    case 'selectLine': case 'selectBlock': case 'selectStyled': case 'selectWord':
    case 'deleteLine': case 'deleteBlock': case 'deleteStyled': case 'deleteWord': return rangeAction(editor, action);
    case 'del': {
      const to = selection.empty ? Math.min(editor.value.length, selection.head + 1) : selection.to;
      editor.view.dispatch({ changes: { from: selection.from, to, insert: '' }, userEvent: 'delete' }); return true;
    }
    case 'clearFormat': {
      if (selection.empty) {
        const line = editor.view.state.doc.lineAt(selection.head);
        editor.view.dispatch({ changes: { from: line.from, to: line.to, insert: clearMarkdown(line.text) }, userEvent: 'input' });
      } else insert(clearMarkdown(editor.view.state.sliceDoc(selection.from, selection.to)));
      return true;
    }
    case 'refreshMath': ctx.refresh(); return true;
    case 'smartQuotes': await setting('smartQuotes', !settings.smartQuotes); return true;
    case 'smartDash': await setting('smartDash', !settings.smartDash); return true;
    case 'lineEndings': {
      const result = await formDialog('换行符', [{ name: 'ending', label: '保存时使用', type: 'select', value: String(settings.lineEndings || 'lf'),
        options: [['lf', 'Unix (LF)'], ['crlf', 'Windows (CRLF)']] }, { name: 'final', label: '文末添加空行', type: 'select', value: String(!!settings.insertFinalNewLineOnSave), options: [['true', '是'], ['false', '否']] }]);
      if (result) { await setting('lineEndings', result.ending); await setting('insertFinalNewLineOnSave', result.final === 'true'); }
      return true;
    }
    case 'spacesBreaks': await invoke('window.openPreferences', 'markdown'); return true;
    case 'emoji': await invoke('window.emoji'); return true;
    case 'copyTable': { const table = blockAt(editor, 'table_open'); if (table) await copy(table.text, false, true); else ctx.notify('请将光标放在表格中。'); return true; }
    case 'tableRowBefore': case 'tableRowAfter': case 'tableDeleteRow': case 'tableColumnBefore': case 'tableColumnAfter': case 'tableDeleteColumn':
      ctx.notify('请将光标放在表格单元格中。'); return true;
    case 'deleteTable': {
      const table = blockAt(editor, 'table_open');
      if (table) editor.view.dispatch({ changes: { from: table.from, to: table.to, insert: '' }, selection: { anchor: table.from }, userEvent: 'delete' });
      return true;
    }
    case 'copyCode': { const fence = codeContent(editor); if (fence) await write(fence.text); else ctx.notify('请将光标放在代码框中。'); return true; }
    case 'prettifyCode': {
      const fence = codeContent(editor);
      if (fence) editor.view.dispatch({ changes: { from: fence.bodyFrom, to: fence.bodyTo, insert: reindentCode(fence.text, fence.lang, Number(settings.codeIndentSize || 4)) }, userEvent: 'input' });
      return true;
    }
    case 'taskDone': setTaskStatus(editor, true); return true;
    case 'taskTodo': setTaskStatus(editor, false); return true;
    case 'insertLinkRef': {
      const result = await formDialog('插入链接引用', [{ name: 'label', label: '引用名称', value: 'link' }, { name: 'url', label: '链接地址', value: 'https://' }]);
      if (result) {
        const label = result.label.replace(/[\[\]\n]/g, '').trim() || 'link';
        insert(`[${label}][${label}]`);
        editor.view.dispatch({ changes: { from: editor.value.length, insert: `\n\n[${label}]: ${result.url}\n` }, userEvent: 'input' });
      }
      return true;
    }
    case 'insertFootnote': {
      let n = 1; while (editor.value.includes(`[^${n}]`)) n++;
      insert(`[^${n}]`);
      const from = editor.value.length, ending = `\n\n[^${n}]: `;
      editor.view.dispatch({ changes: { from, insert: ending }, selection: { anchor: from + ending.length }, scrollIntoView: true, userEvent: 'input' });
      editor.focus(); return true;
    }
    case 'inlineMath': wrapSelection(editor, '$', '$', 'x'); editor.focus(); return true;
    case 'openLink': {
      const link = linkAt(editor);
      if (link) {
        if (/^https?:|^mailto:/i.test(link.href)) await invoke('shell.openExternal', link.href);
        else if (link.href.startsWith('#')) document.getElementById(decodeURIComponent(link.href.slice(1)))?.scrollIntoView();
        else await invoke('shell.openItem', decodeURIComponent(ctx.resolveImage(link.href).replace(/^file:\/\//, '')));
      }
      return true;
    }
    case 'copyLink': { const link = linkAt(editor); if (link) await write(link.href); return true; }
    case 'insertImage': {
      const result = await formDialog('插入图片', [{ name: 'url', label: '图片地址' }, { name: 'alt', label: '替代文本' }]);
      if (result?.url) {
        const [source] = await prepareImages([result.url]);
        insert(`![${result.alt.replace(/[\[\]]/g, '')}](${source})`);
      } return true;
    }
    case 'insertLocalImages': {
      const files = await invoke<string[]>('images.pickLocal');
      if (files.length) {
        const images = await prepareImages(files);
        insert(images.map((src, i) => `![${files[i].split(/[\\/]/).pop()?.replace(/[\[\]]/g, '') ?? ''}](${src})`).join('\n\n'));
      }
      return true;
    }
    case 'uploadAllImages': {
      const matches = [...editor.value.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)];
      if (!matches.length) { ctx.notify('文档中没有可上传的图片。'); return true; }
      const urls = await invoke<string[]>('images.prepare', matches.map((m) => ctx.resolveImage(m[2])), state.file, true);
      editor.view.dispatch({ changes: matches.map((match, i) => ({ from: match.index!, to: match.index! + match[0].length, insert: `![${match[1]}](${urls[i]})` })), userEvent: 'input' });
      ctx.notify('图片上传完成。', 'success'); return true;
    }
    case 'sidebarSearch': ctx.showPanel('search'); document.getElementById('file-library-search-input')?.focus(); return true;
    case 'switchTab': await invoke('document.nextWindow'); return true;
    case 'newTab': await invoke('document.newTab'); return true;
    case 'about': await invoke('window.about'); return true;
    case 'help:recovery': {
      const drafts = await invoke<{ id: string; file: string | null; content: string; encoding: string; modified: number }[]>('document.listDrafts');
      if (!drafts.length) { await show('文档恢复', '没有可恢复的草稿。'); return true; }
      const result = await formDialog('文档恢复', [{ name: 'draft', label: '选择草稿', type: 'select', value: drafts[0].id,
        options: drafts.map((d) => [d.id, `${d.file?.split(/[\\/]/).pop() || '未命名'} · ${new Date(d.modified).toLocaleString()}`]) }], '恢复');
      if (result && await ctx.confirmSave()) {
        const draft = drafts.find((d) => d.id === result.draft)!;
        state.file = draft.file; state.encoding = draft.encoding; editor.setValue(draft.content); await invoke('document.activate', state.file); ctx.changed();
      }
      return true;
    }
    default:
      if (action.startsWith('help:')) { await invoke('help.open', action.slice(5)); return true; }
      return false;
  }
}
