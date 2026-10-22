import { uiText, setUiLanguage } from '../shared/ui-language';
import { selectedLines } from './selected-lines';
import { DocEditor, getDocSnapshot, getHeadings, lineTransform, replaceSelection, wrapSelection } from './editor';
import {
  BlockRange, escapeHtml, extractHeadings, Heading, renderDocument, renderToc, blockRanges,
  Dialect, setDialect,
} from './md';
import { setBlockRenderer, setSingleBlockRenderer } from './editor';
import { undo, redo } from '@codemirror/commands';
import { createExportDocument } from './export-document';
import { formDialog, showText } from './dialogs';
import { runExtraAction } from './extra-actions';
import { rememberDiagram } from './diagram-preview';
import { StatisticsControl } from './statistics-control';
import { SpellcheckControl } from './spellcheck-control';
import { EditorContextMenu } from './context-menu';
import { SidebarControls, type FileSort } from './sidebar-controls';
import { SidebarSearch } from './sidebar-search';

declare global {
  interface Window {
    JSBridge: {
      invoke(method: string, ...args: unknown[]): Promise<any>;
      send(channel: string, payload?: unknown): void;
      on(cb: (e: { type: string; arg?: any }) => void): void;
      pathForFile(file: File): string;
      localFileUrl(source: string, document?: string | null, folder?: string | null, encoded?: boolean): string;
    };
  }
}

const bridge = window.JSBridge;
const invoke = async <T = any>(method: string, ...args: unknown[]): Promise<T> => {
  const result = await bridge.invoke(method, ...args);
  if (result && typeof result === 'object' && typeof result.error === 'string') throw new Error(result.error);
  return result as T;
};
const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

/* ------------------------------------------------------------------ state */

interface AppState {
  file: string | null;
  folder: string | null;
  dirty: boolean;
  encoding: string;
  theme: string;
  dark: boolean;
  statusBar: boolean;
  sidebarVisible: boolean;
  panel: 'outline' | 'files' | 'search';
  focusMode: boolean;
  typewriterMode: boolean;
  sourceMode: boolean;
  zoom: number;
  lang: 'zh' | 'en';
}

const state: AppState = {
  file: null,
  folder: null,
  dirty: false,
  encoding: 'utf-8',
  theme: 'github',
  dark: false,
  statusBar: true,
  sidebarVisible: true,
  panel: 'files',
  focusMode: false,
  typewriterMode: false,
  sourceMode: false,
  zoom: 1,
  lang: 'en' as 'zh' | 'en',
};

let editor: DocEditor;
let settings: Record<string, any> = {};
let contextMenu: EditorContextMenu | undefined;
let mathReady: Promise<void> | null = null;
let mermaidReady: Promise<any> | null = null;
let fileListMode = true;
let sidebarControls: SidebarControls | undefined;
let sidebarSearch: SidebarSearch | undefined;
let fileTreeRevision = 0;
let folderSearchRevision = 0;
let draftTimer: number | undefined;
let draftPending: Promise<unknown> = Promise.resolve();
let currentDraft: string | null = null;

function scheduleDraft(): void {
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    if (!state.dirty) return;
    const file = state.file, content = editor.value, encoding = state.encoding;
    draftPending = draftPending.catch(() => {}).then(async () => {
      currentDraft = await invoke<string>('document.saveDraft', file, content, encoding);
    });
    void draftPending.catch((error) => notify(uiText('草稿备份失败：', 'Draft backup failed: ') + String(error), 'error'));
  }, 1200);
}

async function clearDraft(): Promise<void> {
  window.clearTimeout(draftTimer);
  await draftPending.catch(() => {});
  if (currentDraft) await invoke('document.removeDraft', currentDraft);
  currentDraft = null;
}

/* ------------------------------------------------------------------ math */

function hasMathJax(): boolean {
  return !!(window as any).MathJax?.tex2svg;
}

function loadMathJax(): Promise<void> {
  if (mathReady) return mathReady;
  mathReady = new Promise<void>((resolve) => {
    (window as any).MathJax = {
      startup: { typeset: false },
      tex: { packages: { '[+]': ['autoload', 'ams', 'textmacros', ...(settings.allowPhysicsConflict ? ['physics'] : [])] },
        tags: String(settings.autoNumberingForMath || 'none') },
      svg: { fontCache: 'local', scale: 1 },
      options: { enableMenu: false },
    };
    const s = document.createElement('script');
    s.src = '../../vendor/aropyt-lib/MathJax3/es5/tex-svg-full.js';
    s.async = true;
    s.onload = () => { void Promise.resolve((window as any).MathJax?.startup?.promise).then(() => { resolve(); refreshAllBlocks(); }, () => resolve()); };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return mathReady;
}

function renderMath(tex: string, display: boolean): string {
  if (!hasMathJax()) {
    void loadMathJax();
    return `<span class="md-math-fallback">${escapeHtml(tex)}</span>`;
  }
  try {
    const expression = display && settings.mathLineBreak && /\\\\|\\newline/.test(tex) ? '\\begin{gathered}' + tex.replace(/\\newline/g, '\\\\') + '\\end{gathered}' : tex;
    const node = (window as any).MathJax.tex2svg(expression, { display });
    const out = node.outerHTML ?? node;
    return `<span class="MathJax ${display ? 'md-mathjax-preview' : 'md-mathjax-midline'}">${out}</span>`;
  } catch {
    return `<span class="md-math-error">${escapeHtml(tex)}</span>`;
  }
}

function loadMermaid(): Promise<any> {
  if (mermaidReady) return mermaidReady;
  mermaidReady = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '../../vendor/aropyt-lib/diagram/mermaid.min.js';
    s.async = true;
    s.onload = () => {
      const m = (window as any).mermaid;
      try {
        m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: String(settings.diagramTheme || 'default'),
          themeVariables: { fontSize: String(settings.diagramFontSize || 16) + 'px' } });
      } catch {
        /* older builds ignore */
      }
      resolve(m);
    };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return mermaidReady;
}

/* --------------------------------------------------------------- enhance */

let renderSeq = 0;

function enhance(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.md-math-block'))) {
    if (el.dataset.rendered) continue;
    const tex = el.dataset.tex ?? '';
    el.innerHTML = renderMath(tex, true);
    el.dataset.rendered = '1';
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.md-inline-math'))) {
    if (el.dataset.rendered) continue;
    const tex = el.dataset.tex ?? '';
    el.innerHTML = renderMath(tex, false);
    el.dataset.rendered = '1';
  }
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>('.md-diagram')).filter((d) => !d.dataset.rendered);
  for (const d of diagrams) {
    const request = String(++renderSeq), editing = !!d.closest('.md-diagram-edit-preview');
    d.dataset.renderRequest = request;
    const render = async () => {
      const m = await loadMermaid();
      if (!m || !d.isConnected || d.dataset.renderRequest !== request) return;
      const src = d.dataset.source ?? d.querySelector('.md-diagram-pending')?.textContent ?? '';
      const id = 'mmd-' + request;
        try {
          const { svg } = await m.render(id, src);
          if (!d.isConnected || d.dataset.renderRequest !== request) return;
          const line = Number(d.closest<HTMLElement>('.md-block-widget')?.dataset.line);
          if (line) rememberDiagram(src, line, svg);
          d.innerHTML = svg;
          d.dataset.rendered = '1';
        } catch (err) {
          if (!d.isConnected || d.dataset.renderRequest !== request) return;
          d.querySelector('.md-diagram-panel-error')?.remove();
          const error = `<div class="md-diagram-panel-error">${escapeHtml(String(err))}</div>`;
          if (editing && d.querySelector('svg')) d.insertAdjacentHTML('beforeend', error); else d.innerHTML = error;
          d.dataset.rendered = '1';
        }
    };
    if (editing) window.setTimeout(() => void render(), 180); else void render();
  }
}

/** Maps the stored settings onto the markdown dialect flags. */
function dialectFromSettings(s: Record<string, any>): Partial<Dialect> {
  const on = (key: string, fallback: boolean): boolean => (s[key] === undefined ? fallback : s[key] === true);
  return {
    autoLinks: on('autoLinks', true),
    inlineMath: on('inlineMath', true),
    codeBlockMath: on('codeBlockMath', true),
    subscript: on('subscript', false),
    superscript: on('superscript', false),
    highlight: on('highlight', false),
    githubAlert: on('githubAlert', true),
    diagrams: on('diagrams', true),
    fenceLineNumbers: on('fenceLineNumbers', false),
    defaultCodeLang: String(s.defaultCodeLang ?? ''),
    smartQuotes: on('smartQuotes', true) && s.smartPunctuation !== 'input',
    smartDash: on('smartDash', true) && s.smartPunctuation !== 'input',
    singleLineBreaks: !s.ignoreLineBreak,
    strictMode: on('strictMode', false),
    remapPunctuation: s.remapPunctuation === true,
    visibleBr: on('visibleBr', false),
    smartDoubleQuoteStyle: String(s.smartDoubleQuoteStyle || '“abc”'),
    smartSingleQuoteStyle: String(s.smartSingleQuoteStyle || '‘abc’'),
  };
}

/* ---------------------------------------------------------- block render */

function resolveImageSrc(src: string): string {
  return bridge.localFileUrl(src, state.file, state.folder);
}

function footnoteDefinitions(doc: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of doc.split(/\r?\n/)) {
    if (/^\[\^[^\]]+\]:/.test(line)) {
      inside = true;
      out.push(line);
      continue;
    }
    if (inside && /^(?: {2,}|\t)/.test(line) && line.trim()) {
      out.push(line);
      continue;
    }
    inside = false;
  }
  return out.join('\n');
}

function renderBlockHtml(src: string): string | null {
  const text = src.replace(/\n+$/, '');
  if (!text.trim()) return null;

  // YAML front matter renders as Aropyt's meta block.
  const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*$/.exec(text);
  if (fm) return `<pre class="md-meta-block">${escapeHtml(fm[1])}</pre>`;

  // [toc]
  if (/^\s*\[(toc|TOC)\]\s*$/.test(text)) {
    const toc = renderToc(extractHeadings(editor?.value ?? ''));
    return toc || '<div class="md-toc"><p class="md-toc-content"></p></div>';
  }

  // A footnote definition renders as Aropyt's footnote line, not as a paragraph.
  const def = /^\[\^([^\]]+)\]:[ \t]*(?:[\s\S]*)$/.exec(text);
  if (def) {
    const body = text.replace(/^\[\^[^\]]+\]:[ \t]*/, '').replace(/\n[ \t]{2,}/g, ' ').replace(/\n/g, ' ');
    const label = escapeHtml(def[1]);
    return `<div class="md-footnote md-def-footnote" data-label="${label}">` +
      `<span class="md-fn-count">[^${label}]:</span> ${escapeHtml(body)}` +
      ` <a class="footnote-backref" href="#fnref${label}" title="${uiText('返回引用', 'Jump back to reference')}">\u21A9</a></div>`;
  }

  // Footnote references only resolve when their definitions are in the same
  // parse, so append the document's definitions to any block citing one.
  let source = text;
  let appended = false;
  if (/\[\^[^\]]+\]/.test(source)) {
    const defs = footnoteDefinitions(getDocSnapshot() || editor?.value || '');
    if (defs) {
      source += '\n\n' + defs;
      appended = true;
    }
  }

  try {
    const { html } = renderDocument(source, {
      resolveSrc: resolveImageSrc,
      math: renderMath,
      rootClass: 'md-block-root',
    });
    // Strip the wrapper divs, keep the body markup.
    let inner = /<div id="write"[^>]*>([\s\S]*)<\/div>\s*<\/div>\s*$/.exec(html);
    let out = inner ? inner[1] : html;
    if (appended) {
      // The definitions were only there to resolve the reference; the document
      // bottom owns the rendered footnote list.
      out = out.replace(/<hr class="footnotes-sep">[\s\S]*$/,'').replace(/<section class="footnotes">[\s\S]*$/,'');
    }
    return out;
  } catch {
    return `<pre class="md-fences">${escapeHtml(text)}</pre>`;
  }
}

function refreshAllBlocks(): void {
  editor?.refreshDecorations();
}

/* -------------------------------------------------------------- outline */

const collapsedHeadings = new Set<string>();
function buildOutline(): void {
  const host = $('#outline-content') ?? $('#toc-content');
  if (!host) return;
  const headings = getHeadings(editor);
  if (!headings.length) {
    host.innerHTML = '';
    host.setAttribute('data-empty', '1');
    return;
  }
  host.removeAttribute('data-empty');
  host.innerHTML = headings
    .map(
      (h) =>
        `<div class="outline-item outline-h${h.level}" data-line="${h.line}" data-id="${h.id}">` +
        `<div class="outline-item-wrapper"><div class="outline-label">${escapeHtml(h.text)}</div>` +
        `<div class="outline-item-indicator"></div></div></div>`,
    )
    .join('');
  let hiddenBelow = 7;
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('.outline-item'))) {
    const index = headings.findIndex((h) => h.line === Number(el.dataset.line));
    const heading = headings[index];
    if (heading.level <= hiddenBelow) hiddenBelow = 7;
    el.hidden = hiddenBelow < heading.level;
    const expandable = settings.collapsibleOutline && headings[index + 1]?.level > heading.level;
    if (expandable) {
      const toggle = document.createElement('button');
      const collapsed = collapsedHeadings.has(heading.id);
      toggle.className = 'outline-toggle'; toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-label', collapsed ? uiText('展开章节', 'Expand section') : uiText('折叠章节', 'Collapse section'));
      toggle.addEventListener('click', (event) => { event.stopPropagation();
        if (collapsed) collapsedHeadings.delete(heading.id); else collapsedHeadings.add(heading.id); buildOutline(); });
      el.querySelector('.outline-item-wrapper')?.prepend(toggle);
      if (collapsed && !el.hidden) hiddenBelow = heading.level;
    }
    el.addEventListener('click', () => {
      editor.scrollToLine(Number(el.dataset.line || '0'));
    });
  }
}

/* ------------------------------------------------------------ file tree */

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  mtime?: number;
  size?: number;
  preview?: string[];
  children?: TreeNode[];
}

async function loadTree(dir: string, depth = 0): Promise<TreeNode[]> {
  const entries = await invoke<TreeNode[]>('fs.readDir', dir).catch(() => []);
  const out: TreeNode[] = [];
  for (const e of entries) {
    if (e.isDir) {
      if (depth >= 2) continue;
      out.push({ ...e, children: await loadTree(e.path, depth + 1) });
    } else if (/\.(md|markdown|mdown|txt|rmd)$/i.test(e.name)) {
      out.push(e);
    }
  }
  return sortFiles(out);
}

function fileSort(): { by: FileSort; descending: boolean } {
  return { by: ['name', 'modified'].includes(settings.sidebarSort) ? settings.sidebarSort : 'natural', descending: settings.sidebarSortDescending === true };
}

function sortFiles(nodes: TreeNode[]): TreeNode[] {
  const { by, descending } = fileSort();
  return nodes.sort((a, b) => Number(b.isDir) - Number(a.isDir) || (descending ? -1 : 1) *
    ((by === 'modified' ? (a.mtime || 0) - (b.mtime || 0) : 0) || a.name.localeCompare(b.name, undefined, { numeric: by === 'natural' })));
}

function renderFileCards(nodes: TreeNode[], host: HTMLElement): void {
  for (const node of nodes) {
    const row = document.createElement('div'); row.className = 'file-library-file-node file-list-card'; row.dataset.path = node.path;
    row.tabIndex = 0; row.setAttribute('role', 'button'); row.title = node.path;
    row.classList.toggle('active', node.path === state.file);
    const ext = /\.[^.]+$/.exec(node.name)?.[0] || '';
    row.innerHTML = `<div class="file-card-name"><strong>${escapeHtml(node.name.slice(0, node.name.length - ext.length))}</strong><span class="file-card-extension">${escapeHtml(ext)}</span></div>` +
      `<div class="file-card-preview">${(node.preview || []).map(line => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
    row.addEventListener('click', () => void openFile(node.path));
    row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openFile(node.path); } });
    host.append(row);
  }
}

function renderTree(nodes: TreeNode[], container: HTMLElement, depth = 0): void {
  for (const n of nodes) {
    const row = document.createElement('div');
    row.className = 'file-library-node ' + (n.isDir ? 'file-tree-node' : 'file-library-file-node');
    row.style.paddingLeft = 8 + depth * 14 + 'px';
    row.dataset.path = n.path;
    row.innerHTML = n.isDir
      ? `<span class="file-node-open-state"><i class="fa fa-caret-right"></i></span><i class="file-node-icon fa fa-folder-o"></i><span class="file-node-title">${escapeHtml(n.name)}</span>`
      : `<span class="file-node-open-state"></span><i class="file-node-icon fa fa-file-text-o"></i><span class="file-node-title">${escapeHtml(n.name)}</span>`;
    if (state.file === n.path) row.classList.add('active');
    container.appendChild(row);
    if (n.isDir && n.children) {
      const childBox = document.createElement('div');
      childBox.className = 'file-node-children';
      childBox.style.display = 'none';
      renderTree(n.children, childBox, depth + 1);
      container.appendChild(childBox);
      row.addEventListener('click', () => {
        const open = childBox.style.display !== 'none';
        childBox.style.display = open ? 'none' : '';
        row.querySelector('.fa-caret-right')?.classList.toggle('fa-caret-down', !open);
      });
    } else if (!n.isDir) {
      row.addEventListener('click', () => void openFile(n.path));
    }
  }
}

async function refreshFileTree(): Promise<void> {
  const revision = ++fileTreeRevision;
  const host = $('#file-library-tree');
  if (!host) return;
  const rootFolder = state.folder || state.file?.replace(/[\\/][^\\/]+$/, '');
  sidebarControls?.update(state.panel, fileListMode);
  if (!rootFolder) {
    host.innerHTML = '';
    host.setAttribute('data-state', 'empty');
    return;
  }
  const tree = await loadTree(rootFolder);
  const flatten = (nodes: TreeNode[]): TreeNode[] => nodes.flatMap((node) => node.isDir ? flatten(node.children || []) : [node]);
  const list = fileListMode ? sortFiles(flatten(tree)) : [];
  if (fileListMode) await Promise.all(list.map(async node => {
    if ((node.size || 0) > 1024 * 1024) return;
    const data = await invoke<{ content: string } | string>('fs.readText', node.path, 'utf-8').catch(() => '');
    const text = typeof data === 'string' ? data : data.content;
    node.preview = (text || '').slice(0, 4096).split(/\r?\n/).map(line => line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '').trim()).filter(Boolean).slice(0, 2);
  }));
  if (revision !== fileTreeRevision) return;
  const composer = host.querySelector<HTMLElement>('#sidebar-new-file-row');
  const composing = composer?.contains(document.activeElement);
  host.innerHTML = '';
  host.setAttribute('data-state', 'rendered');
  if (fileListMode) {
    renderFileCards(list, host);
  } else renderTree(tree, host);
  if (composer) { host.append(composer); if (composing) composer.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }
  const label = $('#sidebar-footer-main-item-label');
  if (label) label.textContent = rootFolder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || rootFolder;
}

/* ------------------------------------------------------------- status bar */

let statistics: StatisticsControl | undefined;
let spellcheck: SpellcheckControl | undefined;
function updateStatusBar(): void {
  statistics?.update();
  spellcheck?.documentChanged();
  const headings = getHeadings(editor);
  const active = editor.view.state.doc.lineAt(editor.view.state.selection.main.head).number;
  let current = -1;
  headings.forEach((h) => {
    if (h.line + 1 <= active) current = h.line;
  });
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('#outline-content .outline-item'))) {
    el.classList.toggle('active', Number(el.dataset.line) === current);
  }
}

/* --------------------------------------------------------------- themes */

const DARK_THEMES = new Set(['night', 'dark', 'onedark', 'dracula', 'nord']);

async function applyTheme(name: string): Promise<void> {
  state.theme = name;
  const css = await invoke<string>('theme.getCss', name);
  const el = $('#theme_css');
  if (el) el.textContent = css;
  state.dark = DARK_THEMES.has(name.toLowerCase());
  document.documentElement.classList.toggle('theme-dark', state.dark);
  document.body.classList.toggle('theme-dark', state.dark);
  applyThemeMetrics(css);
  void invoke('setting.setCurTheme', name);
  refreshAllBlocks();
}

/**
 * The bundled themes position the document column through `#write`'s
 * max-width/padding. The editor needs those numbers on `.cm-content` instead
 * (because CodeMirror owns scrolling), so lift them out of the theme CSS.
 */
function applyThemeMetrics(css: string): void {
  const root = document.documentElement.style;
  const rule = /#write\s*\{([^}]*)\}/.exec(css);
  const read = (prop: string): string | null => {
    if (!rule) return null;
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(rule[1]);
    return m ? m[1].trim() : null;
  };
  const maxWidth = read('max-width');
  const padding = read('padding');
  const padTop = read('padding-top');
  const padBottom = read('padding-bottom');
  const padLeft = read('padding-left');
  const padRight = read('padding-right');

  if (maxWidth && maxWidth !== 'initial' && /px|em|rem|%/.test(maxWidth)) {
    root.setProperty('--write-max-width', maxWidth);
  } else {
    root.setProperty('--write-max-width', '860px');
  }
  const pad = padding && /\d/.test(padding) ? padding.split(/\s+/) : null;
  const pick = (idx: number, fallback: string): string => pad && pad[idx] ? pad[idx] : fallback;
  root.setProperty('--write-pad-top', padTop ?? pick(0, '30px'));
  root.setProperty('--write-pad-x', padLeft ?? pick(1, pick(3, '30px')));
  root.setProperty('--write-pad-right', padRight ?? pick(3, pick(1, '30px')));
  root.setProperty('--write-pad-bottom', padBottom ?? pick(2, '100px'));
}

/* -------------------------------------------------------------- document */

function setDirty(dirty: boolean): void {
  if (state.dirty === dirty) return;
  state.dirty = dirty;
  bridge.send('doc.syncChange', { dirty });
  updateTitle();
}

function updateTitle(): void {
  const untitled = state.lang === 'zh' ? '未命名' : uiText('未命名', 'Untitled');
  const name = state.file ? state.file.replace(/\\/g, '/').split('/').pop() : untitled;
  const mark = state.dirty ? ' •' : '';
  const title = `${name}${mark} - Aropyt`;
  const el = $('#title-text');
  if (el) el.textContent = title;
  void invoke('window.setTitle', title);
  document.title = title;
}

async function openFile(file: string, confirmed = false): Promise<void> {
  if (!confirmed && !(await confirmSave(true))) return;
  const res = await invoke<{ content: string; encoding: string } | null>('document.getContent', file);
  if (!res) return;
  await clearDraft();
  state.file = file;
  state.encoding = res.encoding || 'utf-8';
  editor.setValue(res.content);
  spellcheck?.reset();
  setDirty(false);
  await invoke('document.activate', file);
  await invoke('setting.updateRecentFile', file);
  updateTitle();
  buildOutline();
  refreshFileTree();
  await invoke('app.sendEvent', 'doc.dirty', { dirty: false });
}

async function saveFile(saveAs = false): Promise<boolean> {
  let target = state.file;
  if (!target || saveAs) {
    const configured = settings.defaultExtension === 'custom' ? settings.customExtension : settings.defaultExtension;
    const extension = /^\.[a-z0-9]+$/i.test(String(configured)) ? String(configured) : '.md';
    const suggested = target || (state.folder ? state.folder + '/' + uiText('未命名', 'Untitled') + extension : uiText('未命名', 'Untitled') + extension);
    const picked = await invoke<string | null>('export.saveFile', {
      defaultPath: suggested,
      filters: [{ name: 'Markdown', extensions: [extension.slice(1)] }],
      content: editor.value,
    });
    if (!picked) return false;
    target = picked;
  }
  await invoke('document.setContent', target, editor.value, state.encoding);
  await clearDraft();
  state.file = target;
  setDirty(false);
  updateTitle();
  await invoke('setting.updateRecentFile', target);
  refreshFileTree();
  return true;
}

async function confirmSave(switchingFile = false): Promise<boolean> {
  if (!state.dirty) return true;
  if (switchingFile && settings.saveWithoutAsking && state.file) return saveFile();
  const result = await invoke<{ response: number }>('dialog.showMessageBox', {
    type: 'warning', message: uiText('是否保存当前文档的更改？', 'Save changes to the current document?'), buttons: [uiText('保存', 'Save'), uiText('不保存', 'Don’t Save'), uiText('取消', 'Cancel')], defaultId: 0, cancelId: 2,
  });
  if (result.response === 1) { await clearDraft(); return true; }
  return result.response === 0 ? saveFile() : false;
}

async function newDocument(): Promise<void> {
  if (!(await confirmSave())) return;
  await clearDraft();
  state.file = null;
  editor.setValue('');
  spellcheck?.reset();
  setDirty(false);
  state.sourceMode = false;
  editor.setSourceMode(false);
  updateFooterControls();
  updateTitle();
  buildOutline();
  await invoke('document.activate', null);
}

/* --------------------------------------------------------------- actions */

function toggleHeading(level: number): void {
  lineTransform(editor, (line) => {
    const stripped = line.replace(/^#{1,6}\s+/, '');
    if (level === 0) return stripped;
    const hashes = '#'.repeat(level);
    if (level <= 2 && ['setext', 'setextVar'].includes(settings.headingStyle)) {
      return stripped + '\n' + (level === 1 ? '=' : '-').repeat(settings.headingStyle === 'setextVar' ? Math.max(3, stripped.length) : 3);
    }
    if (settings.headingStyle === 'atxSuffix') return `${hashes} ${stripped.replace(/\s+#+$/, '')} ${hashes}`;
    return line.startsWith(hashes + ' ') ? line : `${hashes} ${stripped}`;
  });
  refreshAllBlocks();
}

function listPrefixToggle(prefix: (i: number) => string, test: RegExp): void {
  const view = editor.view;
  const sel = view.state.selection.main;
  const { first, last } = selectedLines(view.state);
  let all = true;
  for (let n = first; n <= last; n++) if (!test.test(view.state.doc.line(n).text)) all = false;

  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = first; n <= last; n++) {
    const line = view.state.doc.line(n);
    const marker = prefix(n - first + 1);
    const spacing = settings.prettyIndent && !marker.startsWith('>') && settings.indentSize !== 'tab' ?
      ' '.repeat(Math.max(0, (Number(settings.indentSize) || 4) - marker.length)) : '';
    const text = all ? line.text.replace(test, '') : marker + spacing + line.text.replace(test, '');
    if (text !== line.text) changes.push({ from: line.from, to: line.to, insert: text });
  }
  if (changes.length) view.dispatch({ changes });
  refreshAllBlocks();
}

function insertBlock(snippet: string, cursorOffset?: number): void {
  const view = editor.view;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const atLineStart = sel.from === line.from;
  const before = sel.from === line.from ? '' : '\n';
  const insert = before + snippet;
  view.dispatch({
    changes: { from: sel.from, to: sel.from, insert },
    selection: { anchor: sel.from + insert.length - (cursorOffset ?? 0) },
  });
  void atLineStart;
  refreshAllBlocks();
}

function insertParagraph(dir: 'before' | 'after'): void {
  const view = editor.view;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  if (dir === 'after') {
    const pos = line.to;
    view.dispatch({ changes: { from: pos, insert: '\n' }, selection: { anchor: pos + 1 } });
  } else {
    const pos = line.from;
    view.dispatch({ changes: { from: pos, insert: '\n' }, selection: { anchor: pos } });
  }
}

function indent(delta: 1 | -1): void {
  const unit = settings.indentSize === 'tab' ? '\t' : ' '.repeat(Number(settings.indentSize) || 4);
  lineTransform(editor, (line) => {
    if (delta === 1) return unit + line;
    const m = new RegExp('^(\\t| {1,' + unit.length + '})').exec(line);
    return m ? line.slice(m[1].length) : line;
  });
}

function zoom(delta: number): void {
  state.zoom = Math.min(3, Math.max(0.4, state.zoom + delta));
  document.documentElement.style.setProperty('--aropyt-zoom', String(state.zoom));
  document.body.style.zoom = String(state.zoom);
  void invoke('setting.put', 'zoomLevel', state.zoom);
}

async function prepareExport(withStyles = true): Promise<string> {
  await loadMathJax();
  (window as any).MathJax?.texReset?.();
  const title = state.file ? state.file.replace(/\\/g, '/').split('/').pop()!.replace(/\.md$/, '') : uiText('未命名', 'Untitled');
  return createExportDocument({
    source: editor.value, title,
    styles: await invoke<string>('export.getStyles', state.theme, withStyles),
    resolveSrc: resolveImageSrc, math: renderMath,
    preserveLineBreaks: settings.preLinebreakOnExport === true || settings.whitespaceOnExport === 'preserve',
    preserveWhitespace: settings.whitespaceOnExport === 'preserve',
    image: (src) => invoke<string>('export.inlineImage', src),
    diagram: async (source) => {
      const mermaid = await loadMermaid();
      if (!mermaid) throw new Error(uiText('Mermaid 引擎加载失败', 'Could not load the Mermaid engine'));
      const { svg } = await mermaid.render('export-mmd-' + ++renderSeq, source);
      return svg;
    },
  });
}

async function exportFile(format: 'html' | 'pdf' | 'png' | 'print', withStyles = true): Promise<void> {
  try {
    const html = await prepareExport(withStyles);
    if (format === 'print') { await invoke('export.print', html); return; }
    const title = state.file ? state.file.replace(/\\/g, '/').split('/').pop()!.replace(/\.[^.]+$/, '') : uiText('未命名', 'Untitled');
    const payload = format === 'html' ? { content: html } : {
      base64: await invoke<string>(format === 'pdf' ? 'export.htmlToPDF' : 'export.htmlToImage', html),
    };
    if ('base64' in payload && typeof payload.base64 !== 'string') throw new Error(uiText('导出生成失败', 'Could not generate the export'));
    const picked = await invoke<string | { error: string } | null>('export.saveFile', {
      defaultPath: await invoke<string>('export.defaultPath', state.file, title + '.' + format),
      filters: [{ name: format.toUpperCase(), extensions: [format] }], ...payload,
    });
    if (picked && typeof picked === 'object') throw new Error(picked.error);
    if (picked) { notify(uiText('已导出至 ', 'Exported to ') + picked, 'success'); if (settings.openAfterExport) await invoke('shell.showItemInFolder', picked); }
  } catch (error) { notify(uiText('导出失败：', 'Export failed: ') + String(error), 'error', 7000); }
}

/* ------------------------------------------------------------- notification */

let notifyTimer: number | undefined;

function notify(message: string, kind: 'info' | 'success' | 'error' = 'info', ms = 2600): void {
  const host = $('#md-notification');
  if (!host) return;
  host.textContent = message;
  host.className = `md-notification md-notification-${kind} show`;
  host.style.display = 'block';
  if (notifyTimer) window.clearTimeout(notifyTimer);
  notifyTimer = window.setTimeout(() => {
    host.classList.remove('show');
    host.style.display = 'none';
  }, ms);
}

/* --------------------------------------------------------------- actions */

async function runAction(action: string, arg?: unknown): Promise<unknown> {
  try {
  if (action === 'toggleWordCount') { spellcheck?.dismiss(); statistics?.toggle(); return true; }
  if (action === 'spellCheck') { statistics?.dismiss(); spellcheck?.toggle(); return true; }
  if (editor.handleImageAction(action) || editor.handleTableAction(action)) return true;
  if (await runExtraAction(action, arg, {
    editor, state, settings, invoke, confirmSave, exportHtml: prepareExport, resolveImage: resolveImageSrc,
    changed: (dirty = true) => { setDirty(dirty); bridge.send('doc.syncChange', { dirty }); updateTitle(); buildOutline(); refreshAllBlocks(); },
    refresh: refreshAllBlocks, showPanel, refreshFiles: refreshFileTree, notify,
  })) return true;
  switch (action) {
    case 'new': await newDocument(); break;
    case 'newWindow': await invoke('document.newWindow'); break;
    case 'open': await invoke('app.openFile'); break;
    case 'openFolder':
      if (typeof arg === 'string') {
        state.folder = arg;
        await invoke('setting.addRecentFolder', arg);
        await refreshFileTree();
        showPanel('files');
      } else {
        const dir = await invoke<string | null>('app.openFolder');
        if (dir) {
          state.folder = dir;
          await refreshFileTree();
          showPanel('files');
        }
      }
      break;
    case 'reopenEncoding': {
      if (!state.file) {
        notify(uiText('请先打开文件', 'Open a file first'), 'info');
        break;
      }
      if (!(await confirmSave())) return false;
      const res = await invoke<{ content: string; encoding: string } | null>(
        'document.reopenEncoding',
        state.file,
        String(arg ?? 'auto'),
      );
      if (res) {
        await clearDraft();
        state.encoding = res.encoding;
        editor.setValue(res.content);
        setDirty(false);
        notify(uiText('编码：', 'Encoding: ') + res.encoding, 'success');
      }
      break;
    }
    case 'save': return saveFile(false);
    case 'saveAs': return saveFile(true);
    case 'saveAll': return invoke('document.saveAll');
    case 'close': await invoke('window.close'); break;
    case 'openQuickly': showQuickOpen(); break;
    case 'openFileLocation':
      if (state.file) await invoke('shell.showItemInFolder', state.file);
      break;
    case 'revealInFileTree': showPanel('files'); break;
    case 'toggleSidebar': toggleSidebar(); break;
    case 'toggleOutline': showPanel('outline'); break;
    case 'showCurrentFiles': showPanel('files'); await refreshFileTree(); break;
    case 'showFileList': fileListMode = true; void invoke('setting.put', 'sidebarFileList', true); showPanel('files'); await refreshFileTree(); break;
    case 'showFileTree': fileListMode = false; void invoke('setting.put', 'sidebarFileList', false); showPanel('files'); await refreshFileTree(); break;
    case 'searchFolder': showPanel('search'); break;
    case 'toggleSource': toggleSourceMode(); break;
    case 'toggleFocus': toggleFocusMode(); break;
    case 'toggleTypewriter': toggleTypewriterMode(); break;
    case 'toggleStatusBar':
      state.statusBar = !state.statusBar;
      document.body.classList.toggle('hide-status-bar', !state.statusBar);
      await invoke('setting.put', 'showStatusBar', state.statusBar);
      break;
    case 'toggleAlwaysOnTop': await invoke('window.toggleAlwaysOnTop'); break;
    case 'toggleFullScreen': await invoke('window.toggleFullScreen'); break;
    case 'toggleDevTools': await invoke('window.toggleDevTools'); break;
    case 'zoomIn': zoom(0.1); break;
    case 'zoomOut': zoom(-0.1); break;
    case 'zoomReset': state.zoom = 1; document.body.style.zoom = '1'; await invoke('setting.put', 'zoomLevel', 1); break;
    case 'find': openSearch(false); break;
    case 'replace': openSearch(true); break;
    case 'findNext': findStep(1); break;
    case 'findPrev': findStep(-1); break;
    case 'preferences': await invoke('window.openPreferences'); break;
    case 'setMenuLanguage':
      await invoke('setting.put', 'menuLanguage', arg);
      break;
    case 'openThemeFolder': await invoke('theme.openFolder'); break;
    case 'setTheme': await applyTheme(String(arg)); await invoke('menu.refreshThemeMenu'); break;
    case 'export:html': await exportFile('html'); break;
    case 'export:html-plain': await exportFile('html', false); break;
    case 'export:pdf': await exportFile('pdf'); break;
    case 'export:image': await exportFile('png'); break;
    case 'print': await exportFile('print'); break;
    case 'insertTable': {
      const result = await formDialog(() => uiText('插入表格', 'Insert Table'), () => [{ name: 'columns', label: uiText('列数', 'Columns'), type: 'number', min: 1, max: 30, value: '3' }, { name: 'rows', label: uiText('行数', 'Rows'), type: 'number', min: 1, max: 100, value: '3' }]);
      if (result) {
        const columns = Math.min(30, Math.max(1, Number(result.columns) || 3)), rows = Math.min(100, Math.max(1, Number(result.rows) || 3));
        const row = '| ' + Array(columns).fill(' ').join(' | ') + ' |\n';
        insertBlock(row + '| ' + Array(columns).fill('---').join(' | ') + ' |\n' + row.repeat(rows - 1));
      }
      break;
    }
    case 'insertFences': { const lang = settings.fenceLangWhen === 'markdown' ? '' : String(settings.defaultCodeLang || ''); insertBlock('```' + lang + '\n\n```', 4 + lang.length); break; }
    case 'insertMathBlock': insertBlock('$$\n\n$$\n', 4); break;
    case 'insertQuote': lineTransform(editor, (l) => (l.startsWith('> ') ? l : '> ' + l)); break;
    case 'insertOrderedList': listPrefixToggle((i) => (settings.orderedDelimiter === 'repeat' ? 1 : i) + '. ', /^\s*\d+\.\s+/); break;
    case 'insertUnorderedList': listPrefixToggle(() => String(settings.bulletChar || '-') + ' ', /^\s*[-*+]\s/); break;
    case 'insertTaskList': lineTransform(editor, (l) => (/^\s*[-*+]\s+\[[ xX]\]/.test(l) ? l : l.replace(/^\s*[-*+]?\s*/, '- [ ] '))); break;
    case 'insertHr': insertBlock('\n---\n'); break;
    case 'insertToc': insertBlock('\n[toc]\n'); break;
    case 'insertFrontMatter': insertBlock('---\ntitle: \n---\n'); break;
    case 'indent': indent(1); break;
    case 'outdent': indent(-1); break;
    case 'headingUp': lineTransform(editor, (l) => { const m = /^(#{1,6})\s+(.*)$/.exec(l); return m ? (m[1].length > 1 ? '#'.repeat(m[1].length - 1) + ' ' + m[2] : m[2]) : l; }); break;
    case 'headingDown': lineTransform(editor, (l) => { const m = /^(#{0,5})\s*(.*)$/.exec(l) ?? []; return m.length ? '#'.repeat(Math.min(6, (m[1] || '').length + 1)) + ' ' + (m[2] || l) : l; }); break;
    case 'strong': wrapSelection(editor, '**', '**'); break;
    case 'emphasis': wrapSelection(editor, '*', '*'); break;
    case 'underline': wrapSelection(editor, '<u>', '</u>'); break;
    case 'inlineCode': wrapSelection(editor, '`', '`'); break;
    case 'strike': wrapSelection(editor, '~~', '~~'); break;
    case 'highlight': wrapSelection(editor, '==', '=='); break;
    case 'superscript': wrapSelection(editor, '^', '^'); break;
    case 'subscript': wrapSelection(editor, '~', '~'); break;
    case 'comment': wrapSelection(editor, '<!-- ', ' -->'); break;
    case 'link': wrapSelection(editor, '[', '](https://)', uiText('文本', 'text')); break;
    case 'image': wrapSelection(editor, '![', '](image.png)', uiText('图片描述', 'alt')); break;
    case 'selectAll': {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.select();
      else editor.selectAll();
      break;
    }
    case 'insertParagraphBefore': insertParagraph('before'); break;
    case 'insertParagraphAfter': insertParagraph('after'); break;
    case 'undo': undo(editor.view); editor.focus(); break;
    case 'redo': redo(editor.view); editor.focus(); break;
    default:
      if (action.startsWith('heading:')) toggleHeading(Number(action.split(':')[1]));
      else throw new Error(uiText('未知操作：', 'Unknown action: ') + action);
  }
  } catch (error) { notify(String(error instanceof Error ? error.message : error), 'error', 7000); return false; }
}

/* ------------------------------------------------------------ UI toggles */

function updateChromeLanguage(): void {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  for (const [selector, zh, en] of [
    ['.outline-title', '大纲', 'Outline'],
    ['#ty-quick-open-folder-category .ty-quick-open-category-title', '固定及最近位置', 'Pinned and Recent Locations'],
    ['#ty-quick-open-recent-category .ty-quick-open-category-title', '最近文件', 'Recent Files'],
    ['#ty-quick-open-infolder-category .ty-quick-open-category-title', '文件搜索结果', 'File Results'],
  ]) document.querySelectorAll(selector).forEach(node => { node.textContent = uiText(zh, en); });
  for (const [selector, zh, en] of [
    ['#w-min', '最小化', 'Minimize'], ['#w-max', '最大化', 'Maximize'],
    ['#w-pin, #w-unpin', '保持窗口在最前端', 'Always on Top'],
    ['#w-restore', '还原窗口', 'Restore'], ['#w-close', '关闭', 'Close'],
    ['#pin-outline-btn', '在侧边栏显示大纲', 'Show Outline in Sidebar'],
  ]) document.querySelectorAll<HTMLElement>(selector).forEach(node => {
    node.title = uiText(zh, en); node.setAttribute('aria-label', node.title);
  });
  for (const [selector, zh, en] of [
    ['#toc-content, #outline-content', '大纲为空', 'Outline is Empty.'],
    ['#file-library-tree', '尚未打开文件夹', 'No Folder is Opened.'],
    ['#file-library-list-children', '没有可用文件', 'No Files Available'],
  ]) document.querySelectorAll<HTMLElement>(selector).forEach(node => { node.dataset.afterContent = uiText(zh, en); });
  $('#sidebar-tabs')?.setAttribute('aria-label', uiText('侧边栏', 'Sidebar'));
  $('#ty-sidebar-footer')?.setAttribute('aria-label', uiText('文件操作', 'File Actions'));
  const quick = $<HTMLInputElement>('#quick-open-input');
  if (quick) { quick.placeholder = uiText('按文件名搜索', 'Search by file name'); quick.setAttribute('aria-label', quick.placeholder); }
}

function updateSidebarVisibility(): void {
  document.body.classList.toggle('sidebar-hidden', !state.sidebarVisible);
  document.body.classList.toggle('has-sidebar', state.sidebarVisible);
  const sidebar = $('#aropyt-sidebar');
  if (sidebar) {
    sidebar.inert = !state.sidebarVisible;
    sidebar.setAttribute('aria-hidden', String(!state.sidebarVisible));
  }
}

function toggleSidebar(): void {
  sidebarControls?.dismiss();
  state.sidebarVisible = !state.sidebarVisible;
  document.body.classList.add('sidebar-animated');
  if (!state.sidebarVisible && $('#aropyt-sidebar')?.contains(document.activeElement)) editor.focus();
  updateSidebarVisibility();
  updateFooterControls();
  void invoke('setting.put', 'sidebarVisible', state.sidebarVisible);
}

function showPanel(panel: AppState['panel']): void {
  state.panel = panel;
  if (!state.sidebarVisible) toggleSidebar();
  sidebarSearch?.update(panel);
  for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.sidebar-tab'))) {
    tab.classList.toggle('active', tab.dataset.panel === panel);
  }
  for (const id of ['outline-content', 'file-library', 'file-library-search']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle('active', (id === 'outline-content' && panel === 'outline') || (id === 'file-library' && panel === 'files') || (id === 'file-library-search' && panel === 'search'));
    (el as HTMLElement).style.display = el.classList.contains('active') ? '' : 'none';
  }
  if (panel === 'outline') buildOutline();
  if (panel === 'files') void refreshFileTree();
  sidebarControls?.update(panel, fileListMode);
  if (panel === 'search') { $('#file-library-search-input')?.focus(); void runFolderSearch(); }
}

function toggleSourceMode(): void {
  state.sourceMode = !state.sourceMode;
  editor.setSourceMode(state.sourceMode);
  document.body.classList.toggle('aropyt-source-mode', state.sourceMode);
  $('#toggle-sourceview-btn')?.classList.toggle('active', state.sourceMode);
  updateFooterControls();
  editor.focus();
}

function toggleFocusMode(): void {
  state.focusMode = !state.focusMode;
  editor.setFocusMode(state.focusMode);
  document.body.classList.toggle('on-focus-mode', state.focusMode);
  $('#toggle-focus-mode-btn')?.classList.toggle('active', state.focusMode);
}

function toggleTypewriterMode(): void {
  state.typewriterMode = !state.typewriterMode;
  editor.setTypewriterMode(state.typewriterMode);
  document.body.classList.toggle('on-typewriter-mode', state.typewriterMode);
  $('#toggle-typewriter-mode-btn')?.classList.toggle('active', state.typewriterMode);
}

function updateFooterControls(): void {
  const zh = state.lang === 'zh', sidebar = $('#footer-sidebar-btn'), source = $('#toggle-sourceview-btn');
  document.body.classList.toggle('aropyt-source-mode', state.sourceMode);
  if (sidebar) {
    sidebar.title = zh ? '显示 / 隐藏侧边栏' : 'Show / Hide Sidebar'; sidebar.setAttribute('aria-label', sidebar.title);
    sidebar.setAttribute('aria-pressed', String(state.sidebarVisible)); sidebar.classList.toggle('active', state.sidebarVisible);
    sidebar.querySelector('i')!.className = 'fa ' + (state.sidebarVisible ? 'fa-angle-left' : 'fa-circle-o');
  }
  if (source) {
    source.classList.toggle('active', state.sourceMode);
    source.title = zh ? state.sourceMode ? '退出源代码模式' : '启用源代码模式' : state.sourceMode ? 'Exit Source Code Mode' : 'Enable Source Code Mode';
    source.setAttribute('aria-label', source.title); source.setAttribute('aria-pressed', String(state.sourceMode));
    source.querySelector('.footer-source-label')!.textContent = zh ? '退出源代码模式' : 'Exit Source Code Mode';
  }
}

/* -------------------------------------------------------------- searching */

let searchHits: { from: number; to: number }[] = [];
let searchIndex = -1;
let searchExpression: RegExp | null = null;

function updateSearchControls(): void {
  const zh = state.lang === 'zh', mode = $('#search-panel-mode') as HTMLSelectElement;
  mode.options[0].textContent = zh ? '查找' : 'Find'; mode.options[1].textContent = zh ? '查找和替换' : 'Find and Replace';
  mode.setAttribute('aria-label', zh ? '查找模式' : 'Search mode');
  const fields = [['search-panel-input', '查找', 'Find'], ['search-panel-replace-input', '替换为', 'Replace with']] as const;
  for (const [id, cn, en] of fields) {
    const input = $('#' + id) as HTMLInputElement; input.placeholder = zh ? cn : en; input.setAttribute('aria-label', input.placeholder);
  }
  for (const [id, cn, en] of [['searchpanel-case-option-btn', '区分大小写', 'Case Sensitive'], ['searchpanel-word-option-btn', '查找整个单词', 'Whole Word'],
    ['searchpanel-regexp-option-btn', '正则表达式', 'Regular Expression'], ['search-panel-prev', '上一个匹配项', 'Previous match'],
    ['search-panel-next', '下一个匹配项', 'Next match'], ['search-panel-close', '关闭查找', 'Close search']]) {
    const button = $('#' + id)!; button.title = zh ? cn : en; button.setAttribute('aria-label', button.title);
  }
  $('#search-panel-replace-label')!.textContent = zh ? '替换为' : 'Replace';
  $('#search-panel-replace-btn')!.textContent = zh ? '替换' : 'Replace';
  $('#search-panel-replaceall-btn')!.textContent = zh ? '全部替换' : 'Replace All';
  $('#md-searchpanel')!.setAttribute('aria-label', zh ? '查找和替换' : 'Find and Replace');
}

function openSearch(replace: boolean): void {
  const panel = $('#md-searchpanel');
  if (!panel) return;
  const preserveQuery = panel.contains(document.activeElement);
  updateSearchControls();
  panel.classList.remove('hide');
  panel.classList.toggle('searchpanel-replace-mode', replace);
  document.body.classList.add('search-open'); document.body.classList.toggle('search-replace-open', replace);
  ($('#search-panel-mode') as HTMLSelectElement).value = replace ? 'replace' : 'find';
  const input = $('#search-panel-input') as HTMLInputElement;
  const sel = editor.view.state.sliceDoc(editor.view.state.selection.main.from, editor.view.state.selection.main.to);
  if (!preserveQuery && sel && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  runSearch();
}

function closeSearch(): void {
  $('#md-searchpanel')?.classList.add('hide');
  document.body.classList.remove('search-open', 'search-replace-open');
  editor.setSearchHighlights([], -1);
  editor.focusSearchHit();
}

function runSearch(select = true, nextFrom?: number): void {
  const input = $('#search-panel-input') as HTMLInputElement | null;
  const status = $('#search-panel-status');
  if (!input) return;
  const q = input.value;
  searchHits = [];
  searchIndex = -1;
  searchExpression = null;
  if (q) {
    const caseSensitive = document.querySelector('#searchpanel-case-option-btn')?.classList.contains('active');
    const regex = document.querySelector('#searchpanel-regexp-option-btn')?.classList.contains('active');
    const text = editor.value;
    const flags = 'g' + (caseSensitive ? '' : 'i');
    try {
      const pattern = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wholeWord = document.querySelector('#searchpanel-word-option-btn')?.classList.contains('active');
      const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])` : pattern, flags + 'u');
      searchExpression = re;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) !== null && guard++ < 5000) {
        searchHits.push({ from: m.index, to: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex += text.codePointAt(re.lastIndex)! > 0xffff ? 2 : 1;
      }
    } catch {
      if (status) status.textContent = state.lang === 'zh' ? '表达式无效' : 'Invalid regex';
      editor.setSearchHighlights([], -1);
      return;
    }
  }
  if (status) status.textContent = q ? `0 / ${searchHits.length}` : '';
  if (searchHits.length) {
    const selection = editor.view.state.selection.main;
    searchIndex = nextFrom === undefined && !select ? searchHits.findIndex(hit => hit.from === selection.from && hit.to === selection.to) : -1;
    if (searchIndex < 0) searchIndex = Math.max(0, nextFrom === undefined && select ? 0 : searchHits.findIndex(hit => hit.from >= (nextFrom ?? selection.from)));
    if (select) selectHit(searchIndex);
    else { editor.setSearchHighlights(searchHits, searchIndex); if (status) status.textContent = `${searchIndex + 1} / ${searchHits.length}`; }
  } else editor.setSearchHighlights([], -1);
}

function selectHit(i: number): void {
  const hit = searchHits[i];
  if (!hit) return;
  const control = document.activeElement as HTMLElement | null;
  const panel = $('#md-searchpanel'), keepFocus = panel?.contains(control);
  if (panel?.classList.contains('hide')) {
    editor.setSearchHighlights([], -1);
    editor.view.dispatch({ selection: { anchor: hit.from, head: hit.to }, scrollIntoView: true });
  } else editor.setSearchHighlights(searchHits, i, true);
  $('#search-panel-status')!.textContent = `${i + 1} / ${searchHits.length}`;
  if (keepFocus) control?.focus({ preventScroll: true }); else editor.focusSearchHit();
}

function findStep(dir: 1 | -1): void {
  if ($('#md-searchpanel')?.classList.contains('hide')) {
    const selection = editor.view.state.selection.main;
    runSearch(false);
    if (!searchHits.length) return;
    const current = searchHits.findIndex(hit => hit.from === selection.from && hit.to === selection.to);
    if (current >= 0) searchIndex = (current + dir + searchHits.length) % searchHits.length;
    else if (dir === 1) searchIndex = Math.max(0, searchHits.findIndex(hit => hit.from >= selection.to));
    else {
      searchIndex = searchHits.length - 1;
      for (let index = 0; index < searchHits.length; index++) if (searchHits[index].to <= selection.from) searchIndex = index;
    }
    selectHit(searchIndex); return;
  }
  if (!searchHits.length) return;
  searchIndex = (searchIndex + dir + searchHits.length) % searchHits.length;
  selectHit(searchIndex);
}

function replaceCurrent(): void {
  const hit = searchHits[searchIndex];
  if (!hit) return;
  const input = $('#search-panel-replace-input') as HTMLInputElement;
  const insert = searchReplacement(hit, input.value), caret = hit.from + insert.length;
  const next = caret + (hit.from === hit.to ? editor.value.codePointAt(hit.to)! > 0xffff ? 2 : 1 : 0);
  editor.view.dispatch({ changes: { from: hit.from, to: hit.to, insert }, selection: { anchor: caret } });
  runSearch(true, next);
  refreshAllBlocks();
}

function replaceAll(): void {
  const input = $('#search-panel-replace-input') as HTMLInputElement;
  if (!searchHits.length) return;
  const text = editor.value;
  const changes = searchHits.map((h) => ({ from: h.from, to: h.to, insert: searchReplacement(h, input.value, text) }));
  editor.view.dispatch({ changes });
  runSearch();
  refreshAllBlocks();
}

function searchReplacement(hit: { from: number; to: number }, replacement: string, text = editor.value): string {
  if (!searchExpression || !$('#searchpanel-regexp-option-btn')?.classList.contains('active')) return replacement;
  // Read captures from the full document. WebKit's native sticky replace path
  // can ignore lastIndex; expanding the tokens from exec avoids that path.
  const expression = new RegExp(searchExpression.source, searchExpression.flags.replace('g', '') + 'y');
  expression.lastIndex = hit.from;
  const match = expression.exec(text);
  if (!match || match.index !== hit.from) return text.slice(hit.from, hit.to);
  return replacement.replace(/\$(\$|&|`|'|<([^>]+)>|(\d{1,2}))/g, (token, key: string, name: string | undefined, digits: string | undefined) => {
    if (key === '$') return '$';
    if (key === '&') return match[0];
    if (key === '`') return text.slice(0, hit.from);
    if (key === "'") return text.slice(hit.to);
    if (name !== undefined) return match.groups ? match.groups[name] ?? '' : token;
    const index = Number(digits);
    if (index > 0 && index < match.length) return match[index] ?? '';
    const first = Number(digits?.[0]);
    return digits?.length === 2 && first > 0 && first < match.length ? (match[first] ?? '') + digits[1] : token;
  });
}

/* ------------------------------------------------------------- quick open */

let quickItems: { label: string; sub: string; path: string }[] = [];
let quickIndex = 0;

async function showQuickOpen(): Promise<void> {
  const host = $('#aropyt-quick-open');
  if (!host) return;
  host.style.display = 'block';
  const input = $('#quick-open-input') as HTMLInputElement;
  input.value = '';
  input.focus();
  quickItems = [];
  const recent = await invoke<string[]>('setting.getRecentFiles');
  for (const f of recent) quickItems.push({ label: f.replace(/\\/g, '/').split('/').pop()!, sub: f, path: f });
  if (state.folder) {
    const files = await invoke<{ name: string; path: string }[]>('fs.listMarkdown', state.folder, 3);
    for (const f of files) quickItems.push({ label: f.name, sub: f.path, path: f.path });
  }
  renderQuick();
}

function renderQuick(): void {
  const list = $('#aropyt-quick-open-list');
  if (!list) return;
  const q = (($('#quick-open-input') as HTMLInputElement)?.value || '').toLowerCase();
  const filtered = quickItems.filter((i) => !q || i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)).slice(0, 40);
  quickIndex = Math.min(quickIndex, Math.max(0, filtered.length - 1));
  list.innerHTML = filtered
    .map(
      (i, idx) =>
        `<div class="aropyt-quick-open-item${idx === quickIndex ? ' active' : ''}" data-path="${escapeHtml(i.path)}">` +
        `<div class="aropyt-quick-open-item-title">${escapeHtml(i.label)}</div>` +
        `<div class="aropyt-quick-open-item-path">${escapeHtml(i.sub)}</div></div>`,
    )
    .join('');
  for (const el of Array.from(list.querySelectorAll<HTMLElement>('.aropyt-quick-open-item'))) {
    el.addEventListener('click', () => {
      void openFile(el.dataset.path!);
      hideQuickOpen();
    });
  }
}

function hideQuickOpen(): void {
  const host = $('#aropyt-quick-open');
  if (host) host.style.display = 'none';
  editor.focus();
}

/* ---------------------------------------------------------- folder search */

async function runFolderSearch(): Promise<void> {
  const input = $('#file-library-search-input') as HTMLInputElement | null;
  const host = $('#file-library-search-result');
  if (!input || !host) return;
  const revision = ++folderSearchRevision, q = input.value;
  const folder = state.folder || state.file?.replace(/[\\/][^\\/]+$/, '');
  host.setAttribute('aria-busy', 'false');
  if (!q || !folder) {
    host.innerHTML = '';
    return;
  }
  host.setAttribute('aria-busy', 'true');
  let hits: { file: string; line: number; text: string }[];
  try {
    hits = await invoke('search.findAll', folder, q, sidebarSearch?.filters || {});
  } catch (error) {
    if (revision === folderSearchRevision) { host.textContent = String(error); host.setAttribute('aria-busy', 'false'); }
    return;
  }
  if (revision !== folderSearchRevision || folder !== (state.folder || state.file?.replace(/[\\/][^\\/]+$/, ''))) return;
  host.setAttribute('aria-busy', 'false');
  const byFile = new Map<string, { line: number; text: string }[]>();
  for (const h of hits) {
    const list = byFile.get(h.file) ?? [];
    list.push(h);
    byFile.set(h.file, list);
  }
  host.innerHTML = '';
  for (const [file, matches] of byFile) {
    const item = document.createElement('div');
    item.className = 'ty-search-item';
    item.innerHTML =
      `<div class="ty-search-item-summary"><div class="file-list-item-file-name"><span class="file-list-item-file-name-part">${escapeHtml(file.replace(/\\/g, '/').split('/').pop()!)}</span></div>` +
      `<div class="file-list-item-right"><span class="file-list-item-count">${matches.length}</span></div>` +
      `<div class="file-list-item-parent-loc">${escapeHtml(file)}</div></div>` +
      `<div class="ty-search-item-matches">${matches
        .slice(0, 8)
        .map((m) => `<div class="ty-search-item-match" data-line="${m.line}">${escapeHtml(m.text.trim()).slice(0, 160)}</div>`)
        .join('')}</div>`;
    item.querySelector('.ty-search-item-summary')?.addEventListener('click', () => void openFile(file));
    host.appendChild(item);
  }
}

/* --------------------------------------------------------------- keymap */

const KEY_ACTIONS: [string, string][] = [
  ['Ctrl+1', 'heading:1'], ['Ctrl+2', 'heading:2'], ['Ctrl+3', 'heading:3'],
  ['Ctrl+4', 'heading:4'], ['Ctrl+5', 'heading:5'], ['Ctrl+6', 'heading:6'], ['Ctrl+0', 'heading:0'],
  ['Ctrl+b', 'strong'], ['Ctrl+i', 'emphasis'], ['Ctrl+u', 'underline'],
  ['Ctrl+Shift+`', 'inlineCode'], ['Ctrl+Shift+h', 'highlight'], ['Ctrl+k', 'link'],
  ['Ctrl+Shift+i', 'image'], ['Ctrl+\\', 'clearFormat'],
  ['Ctrl+/', 'toggleSource'], ['Ctrl+Shift+l', 'toggleSidebar'],
  ['Ctrl+f', 'find'], ['Ctrl+h', 'replace'], ['F3', 'findNext'], ['Shift+F3', 'findPrev'],
  ['Ctrl+s', 'save'], ['Ctrl+Shift+s', 'saveAs'], ['Ctrl+n', 'new'], ['Ctrl+o', 'open'],
  ['Ctrl+p', 'openQuickly'], ['Ctrl+Shift+k', 'insertFences'], ['Ctrl+Shift+m', 'insertMathBlock'],
  ['Ctrl+Shift+q', 'insertQuote'], ['Ctrl+Shift+x', 'insertTaskList'], ['Ctrl+]', 'indent'], ['Ctrl+[', 'outdent'],
  ['Ctrl+Enter', 'insertParagraphAfter'], ['Ctrl+Shift+Enter', 'insertParagraphBefore'],
  ['Ctrl+Shift+d', 'deleteBlock'], ['F8', 'toggleFocus'], ['F9', 'toggleTypewriter'],
  ['Ctrl+Alt+Shift+l', 'deleteLine'],
];

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || (/Mac/i.test(navigator.platform) && e.metaKey)) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key.length === 1 ? e.key : e.key;
  parts.push(key);
  return parts.join('+');
}

function installKeymap(): void {
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const combo = comboOf(e);
    const field = (e.target as HTMLElement)?.closest('input, textarea, select');
    if (field) {
      const primary = /Mac/i.test(navigator.platform) ? e.metaKey && !e.ctrlKey : e.ctrlKey;
      if (!primary || e.isComposing) return;
      if (combo.toLowerCase() === 'ctrl+a' && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
        e.preventDefault(); field.select();
      } else if (field.closest('#md-searchpanel, #sidebar-search-reveal')) {
        const action = ({ 'ctrl+z': 'undo', 'ctrl+shift+z': 'redo', 'ctrl+y': 'redo' } as Record<string, string>)[combo.toLowerCase()];
        if (action) { e.preventDefault(); void runAction(action); }
      }
      return;
    }
    const custom = Object.entries(settings.keyBinding || {}).find(([, binding]) =>
      String(binding).replace(/CommandOrControl|CmdOrCtrl|Command|Cmd|Meta/gi, 'Ctrl').toLowerCase() === combo.toLowerCase());
    const direct = custom ? [String(custom[1]), custom[0]] : KEY_ACTIONS.find(([k]) => k.toLowerCase() === combo.toLowerCase());
    if (direct) {
      e.preventDefault();
      void runAction(direct[1]);
    }
  }, true);
}

/* ------------------------------------------------------------------ boot */

async function boot(): Promise<void> {
  // Subscribe before the first asynchronous load or component subscriber.
  // Native menu/settings events arriving during startup belong to the app.
  const startupEvents: { type: string; arg?: any }[] = [];
  let receiveEvent: ((event: { type: string; arg?: any }) => void) | undefined;
  bridge.on(event => { if (receiveEvent) receiveEvent(event); else startupEvents.push(event); });
  document.body.classList.add('native-window');
  if (/Mac/i.test(navigator.platform)) {
    document.body.classList.remove('on-windows');
    document.body.classList.add('on-mac');
  }
  settings = (await invoke<Record<string, any>>('setting.getAll')) ?? {};
  try {
    const info = await invoke<{ lang: 'zh' | 'en' }>('menu.dump');
    state.lang = info?.lang === 'zh' ? 'zh' : 'en';
  } catch {
    state.lang = 'en';
  }

  setUiLanguage(state.lang);
  updateChromeLanguage();
  setBlockRenderer(blockRanges);
  setSingleBlockRenderer(renderBlockHtml);
  setDialect(dialectFromSettings(settings));

  let initialDoc = '';
  const startFile = new URLSearchParams(location.search).get('file') || (window as any).__AROPYT_FILE__ as string | undefined;
  if (startFile) {
    const res = await invoke<{ content: string; encoding: string } | null>('document.getContent', startFile);
    if (res) {
      initialDoc = res.content;
      state.file = startFile;
      state.encoding = res.encoding || 'utf-8';
    }
  }

  editor = new DocEditor({
    parent: $('#md-editor')!,
    doc: initialDoc,
    preferences: settings,
    host: {
      language: () => state.lang,
      docDir: () => (state.file ? state.file.replace(/[\\/][^\\/]+$/, '') : state.folder ?? undefined),
      math: renderMath,
      resolveSrc: resolveImageSrc,
      enhance,
    },
    onChange: () => {
      contextMenu?.dismiss();
      setDirty(true);
      scheduleDraft();
      scheduleDerivedUpdate();
      queueMicrotask(() => { if (!$('#md-searchpanel')?.classList.contains('hide')) runSearch(false); });
    },
  });

  statistics = new StatisticsControl(editor, () => ({ settings, lang: state.lang }));
  spellcheck = new SpellcheckControl(editor, () => ({ settings, lang: state.lang }));
  contextMenu = new EditorContextMenu(editor, () => ({ settings, lang: state.lang, file: state.file,
    spelling: spellcheck?.state.enabled ?? false, resolveImage: resolveImageSrc }), invoke, runAction, notify);
  editor.setCursorListener(() => updateStatusBar());
  setDirty(false);
  updateTitle();

  state.theme = String(settings.theme ?? 'github');
  await applyTheme(state.theme);
  state.statusBar = settings.showStatusBar !== false;
  document.body.classList.toggle('hide-status-bar', !state.statusBar);

  const launchFolder = settings.onLaunch === 'custom' ? settings.launchCustomFolder :
    ['folders', 'both'].includes(settings.onLaunch) ? settings.lastFolder : null;
  if (launchFolder && await invoke('fs.isDir', launchFolder)) {
    state.folder = String(launchFolder);
  }
  fileListMode = settings.sidebarFileList !== false;
  await refreshFileTree();
  buildOutline();
  updateStatusBar();
  // The sidebar starts hidden; showPanel() would force it open, so set up the
  // panel contents directly and leave visibility alone.
  state.sidebarVisible = settings.sidebarVisible === true;
  state.panel = 'files';
  updateSidebarVisibility();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.sidebar-content-content'))) {
    el.style.display = el.id === 'file-library' ? '' : 'none';
    el.classList.toggle('active', el.id === 'file-library');
  }

  installKeymap();
  sidebarControls = new SidebarControls({
    lang: () => state.lang,
    root: () => state.folder || state.file?.replace(/[\\/][^\\/]+$/, '') || null,
    run: runAction, refresh: refreshFileTree, sort: fileSort,
    setSort: async (by, descending) => {
      settings.sidebarSort = by; settings.sidebarSortDescending = descending;
      await invoke('setting.put', 'sidebarSort', by); await invoke('setting.put', 'sidebarSortDescending', descending); await refreshFileTree();
    },
    create: async path => {
      if (!(await confirmSave(true))) return false;
      await invoke('fs.createFile', path); await openFile(path, true); editor.focus(); return true;
    },
    notify: message => notify(message, 'error'),
  });
  sidebarControls.update(state.panel, fileListMode);
  sidebarSearch = new SidebarSearch({ lang: () => state.lang, panel: () => state.panel, show: showPanel, search: runFolderSearch });
  sidebarSearch.update(state.panel);
  wireUi();
  updateFooterControls();
  scheduleAutoSave();
  applyChromeFromSettings();
  applyEditorAppearance();
  state.zoom = Math.min(3, Math.max(0.4, Number(settings.zoomLevel) || 1));
  document.body.style.zoom = String(state.zoom);

  receiveEvent = (event) => {
    if (event.type === 'menu') { editor.syncNativeSelection(); void runAction(event.arg.action, event.arg.arg); }
    else if (event.type === 'open-file') void openFile(event.arg);
    else if (event.type === 'reapply-theme') void reapplyThemeFromSettings();
    else if (event.type === 'reapply-chrome') applyChromeFromSettings();
    else if (event.type === 'setting-changed') void onSettingChanged(event.arg);
    else if (event.type === 'set-mode') {
      const m = event.arg as { mode: string; on: boolean };
      if (m.mode === 'typewriter') { state.typewriterMode = false; editor.setTypewriterMode(false); document.body.classList.remove('on-typewriter-mode'); }
      if (m.mode === 'focus') { state.focusMode = false; editor.setFocusMode(false); document.body.classList.remove('on-focus-mode'); }
    }
    else if (event.type === 'window-state') document.body.classList.toggle('maximized', event.arg === 'maximized');
    else if (event.type === 'request-close') {
      void confirmSave().then(async (close) => { if (close) await invoke('app.onCloseWin'); });
    }
  };
  for (const event of startupEvents) receiveEvent(event);

  (window as any).__aropyt = { renderBlockHtml, footnoteDefinitions, state, runAction, blockRanges, prepareExport, confirmSave, getEditor: () => editor };

  document.body.classList.remove('ty-before-first-render');
  void loadMathJax();
}

async function reapplyThemeFromSettings(): Promise<void> {
  const s = (await invoke<Record<string, any>>('setting.getAll')) ?? {};
  settings = s;
  const dark = await invoke<boolean>('theme.isDark');
  const name = String(s.useSeparateDarkTheme && dark ? (s.darkTheme ?? s.theme) : s.theme);
  await applyTheme(name);
}

function applyChromeFromSettings(): void {
  state.statusBar = settings.showStatusBar !== false;
  document.body.classList.toggle('hide-status-bar', !state.statusBar);
}

function applyEditorAppearance(): void {
  const size = settings.useCustomFontSize || settings.fontSizeMode === 'custom' ? Number(settings.customFontSize ?? 16) : 0;
  document.documentElement.style.setProperty('--aropyt-base-font', size ? size + 'px' : '');
  document.body.classList.toggle('custom-font-size', !!size);
  document.body.style.fontSize = size ? size + 'px' : '';
  document.body.classList.toggle('indent-first-line', !!settings.indentFirstLine);
  document.body.classList.toggle('collapse-paragraph-whitespace', settings.whitespaceOnEdit === 'ignore');
}

async function onSettingChanged(change: { key: string; value: unknown }): Promise<void> {
  settings[change.key] = change.value;
  editor.configure({ ...settings, spellCheck: spellcheck?.state.enabled ?? settings.spellCheck });
  if (change.key === 'showStatusBar') applyChromeFromSettings();
  if (['showWordCount', 'showStatusBar', 'wordCountUnit', 'readingSpeed', 'menuLanguage'].includes(change.key)) statistics?.update();
  if (['spellCheck', 'presetSpellCheck', 'spellcheckForCodeAndLink', 'showStatusBar', 'menuLanguage'].includes(change.key)) spellcheck?.update();
  if (['useCustomFontSize', 'customFontSize', 'fontSizeMode'].includes(change.key)) {
    applyEditorAppearance();
  }
  if (['autoSave', 'autoSaveDelay'].includes(change.key)) scheduleAutoSave();
  if (change.key === 'collapsibleOutline') buildOutline();
  // Any syntax-support / code-fence switch changes how blocks parse and render.
  if (['autoLinks', 'inlineMath', 'codeBlockMath', 'subscript', 'superscript', 'highlight',
       'githubAlert', 'diagrams', 'fenceLineNumbers', 'defaultCodeLang', 'smartQuotes', 'smartDash', 'ignoreLineBreak',
       'strictMode', 'remapPunctuation', 'visibleBr', 'smartPunctuation', 'smartDoubleQuoteStyle', 'smartSingleQuoteStyle'].includes(change.key)) {
    if (setDialect(dialectFromSettings(settings))) refreshAllBlocks();
  }
  if (['diagramTheme', 'diagramFontSize'].includes(change.key)) {
    const m = await loadMermaid();
    m?.initialize({ startOnLoad: false, securityLevel: 'loose', theme: String(settings.diagramTheme || 'default'),
      themeVariables: { fontSize: String(settings.diagramFontSize || 16) + 'px' } });
    refreshAllBlocks();
  }
  if (change.key === 'indentFirstLine') document.body.classList.toggle('indent-first-line', !!change.value);
  if (change.key === 'whitespaceOnEdit') document.body.classList.toggle('collapse-paragraph-whitespace', change.value === 'ignore');
  if (change.key === 'menuLanguage') {
    const info = await invoke<{ lang: 'zh' | 'en' }>('menu.dump');
    state.lang = info?.lang === 'zh' ? 'zh' : 'en';
    setUiLanguage(state.lang);
    updateChromeLanguage();
    editor.refreshUiLanguage();
    buildOutline();
    window.dispatchEvent(new Event('aropyt-language-changed'));
    statistics?.update();
    spellcheck?.update(); updateFooterControls(); sidebarSearch?.update(state.panel);
    updateSearchControls();
    if (!$('#md-searchpanel')?.classList.contains('hide')) runSearch(false);
    if (state.panel === 'search') void runFolderSearch();
    updateTitle();
    void refreshFileTree();
  }
}

/* ------------------------------------------------------------- auto save */

let autoSaveTimer: number | undefined;

function scheduleAutoSave(): void {
  if (autoSaveTimer) window.clearInterval(autoSaveTimer);
  autoSaveTimer = undefined;
  if (!settings.autoSave) return;
  const delay = Math.max(1000, Number(settings.autoSaveDelay ?? 5000));
  autoSaveTimer = window.setInterval(() => {
    if (state.dirty && state.file) void saveFile(false);
  }, delay);
}

let derivedTimer: number | undefined;
function scheduleDerivedUpdate(): void {
  if (derivedTimer) window.clearTimeout(derivedTimer);
  derivedTimer = window.setTimeout(() => {
    buildOutline();
    updateStatusBar();
  }, 260);
}

/* -------------------------------------------------------------- UI wire */

function wireUi(): void {
  editor.view.dom.addEventListener('wheel', (event) => {
    if (settings.zoomByMouse && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); zoom(event.deltaY < 0 ? 0.05 : -0.05);
    }
  }, { passive: false });
  const insertImages = async (paths: string[]) => {
    const yaml = /^---\s*\n([\s\S]*?)\n---/.exec(editor.value)?.[1] || '';
    const upload = settings.autoUploadByYaml && /^typora-copy-images-to:\s*['"]?upload['"]?\s*$/m.test(yaml);
    const sources = await invoke<string[]>('images.prepare', paths, state.file, !!upload);
    replaceSelection(editor, sources.map((source) => `![${uiText('图片', 'image')}](${source})`).join('\n')); editor.focus();
  };
  editor.view.dom.addEventListener('paste', (event) => {
    const images = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault(); event.stopPropagation();
    void (async () => {
      const paths = images.map((file) => bridge.pathForFile(file)).filter(Boolean);
      if (!paths.length) { const copied = await invoke<string | null>('images.saveClipboard'); if (copied) paths.push(copied); }
      if (paths.length) await insertImages(paths);
    })().catch((error) => notify(String(error), 'error'));
  }, true);
  editor.view.dom.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  const dropFiles = (event: Event, paths: { source: string; name: string; type: string }[]) => {
    if (!paths.length) return;
    event.preventDefault(); event.stopPropagation();
    void (async () => {
      for (const file of paths) {
        const source = file.source; if (!source) continue;
        if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|svg|webp|bmp|tiff)$/i.test(source)) { await insertImages([source]); continue; }
        const folder = await invoke<boolean>('fs.isDir', source);
        const markdown = /\.(md|markdown|mdown|mkd|txt|text|rmd)$/i.test(source);
        const importable = /\.(docx|odt|epub|html?|rst|tex|textile|opml)$/i.test(source);
        const action = folder ? settings.actionWhenDropFolder : markdown ? settings.actionWhenDropFile : importable ? settings.actionWhenDropImport : 'link';
        if (folder && action === 'open') { state.folder = source; await invoke('setting.addRecentFolder', source); await refreshFileTree(); showPanel('files'); }
        else if (markdown && action === 'open') await openFile(source);
        else if (importable && action === 'import') {
          if (!(await confirmSave())) return;
          const imported = await invoke<{ content: string } | null>('pandoc.import', source);
          if (imported) { await clearDraft(); state.file = null; await invoke('document.activate', null); editor.setValue(imported.content); updateTitle(); }
        } else replaceSelection(editor, `[${file.name}](<${bridge.localFileUrl(source, null, null, false)}>)`);
      }
    })().catch((error) => notify(String(error), 'error'));
  };
  editor.view.dom.addEventListener('drop', event => dropFiles(event, Array.from(event.dataTransfer?.files || []).map(file => ({ source: bridge.pathForFile(file), name: file.name, type: file.type }))), true);
  editor.view.dom.addEventListener('aropyt-drop', event => dropFiles(event, (event as CustomEvent<string[]>).detail.map(source => ({ source, name: source.split(/[\\/]/).pop() || source, type: '' }))), true);
  $('#w-min')?.addEventListener('click', () => void invoke('window.minimize'));
  $('#w-max')?.addEventListener('click', () => void invoke('window.maximize'));
  $('#w-restore')?.addEventListener('click', () => void invoke('window.restore'));
  $('#w-close')?.addEventListener('click', () => void invoke('window.close'));
  $('#w-pin')?.addEventListener('click', () => void invoke('window.pin'));
  $('#w-unpin')?.addEventListener('click', () => void invoke('window.unpin'));

  for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.sidebar-tab'))) {
    tab.addEventListener('click', () => showPanel(tab.dataset.panel as AppState['panel']));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('#ty-footer button')) {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
    });
  }
  $('#footer-sidebar-btn')?.addEventListener('click', toggleSidebar);
  $('#toggle-sourceview-btn')?.addEventListener('click', toggleSourceMode);
  $('#footer-word-count')?.addEventListener('click', () => spellcheck?.dismiss());
  $('#footer-spell-check')?.addEventListener('click', () => statistics?.dismiss());
  $('#switch-file-list-btn')?.addEventListener('click', () => void runAction(fileListMode ? 'showFileTree' : 'showFileList'));
  $('#aropyt-sidebar-resizer')?.addEventListener('mousedown', startSidebarResize);

  const searchInput = $('#search-panel-input') as HTMLInputElement | null;
  updateSearchControls();
  $('#search-panel-mode')?.addEventListener('change', event => openSearch((event.target as HTMLSelectElement).value === 'replace'));
  $('#md-searchpanel')?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSearch(); } });
  searchInput?.addEventListener('input', () => {
    runSearch();
  });
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') closeSearch();
  });
  $('#search-panel-prev')?.addEventListener('click', () => findStep(-1));
  $('#search-panel-next')?.addEventListener('click', () => findStep(1));
  $('#search-panel-close')?.addEventListener('click', closeSearch);
  $('#search-panel-replace-btn')?.addEventListener('click', replaceCurrent);
  $('#search-panel-replaceall-btn')?.addEventListener('click', replaceAll);
  $('#search-panel-replace-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(); } });
  for (const id of ['searchpanel-case-option-btn', 'searchpanel-regexp-option-btn', 'searchpanel-word-option-btn']) {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const button = e.currentTarget as HTMLElement;
      button.classList.toggle('active'); button.setAttribute('aria-pressed', String(button.classList.contains('active')));
      runSearch();
    });
  }

  const qi = $('#quick-open-input') as HTMLInputElement | null;
  qi?.addEventListener('input', renderQuick);
  qi?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideQuickOpen();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      quickIndex++;
      renderQuick();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      quickIndex = Math.max(0, quickIndex - 1);
      renderQuick();
    } else if (e.key === 'Enter') {
      const el = document.querySelector<HTMLElement>('#aropyt-quick-open-list .aropyt-quick-open-item.active, #aropyt-quick-open-list .aropyt-quick-open-item');
      if (el) {
        void openFile(el.dataset.path!);
        hideQuickOpen();
      }
    }
  });

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('#aropyt-quick-open') && !target.closest('[data-open-quick]')) {
      const host = $('#aropyt-quick-open');
      if (host && host.style.display === 'block') hideQuickOpen();
    }
  });

}

/* --------------------------------------------------------- sidebar resize */

function startSidebarResize(e: MouseEvent): void {
  e.preventDefault();
  const sidebar = $('#aropyt-sidebar');
  if (!sidebar) return;
  const startX = e.clientX;
  const startW = sidebar.getBoundingClientRect().width;
  document.body.classList.add('sidebar-resizing');
  const onMove = (ev: MouseEvent) => {
    const w = Math.max(120, Math.min(640, startW + ev.clientX - startX));
    document.documentElement.style.setProperty('--sidebar-width', w + 'px');
  };
  const onUp = () => {
    document.body.classList.remove('sidebar-resizing');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

/* ------------------------------------------------------------------ start */

window.addEventListener('DOMContentLoaded', () => {
  void boot().catch((err) => {
    console.error('boot failed', err);
    document.body.innerHTML = `<pre style="padding:24px;color:#c00">${escapeHtml(String(err?.stack ?? err))}</pre>`;
  });
});

export { state };
