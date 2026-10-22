/* Settings window — pane definitions.
 *
 * Each pane groups rows; a row declares its own key so the renderer can build
 * the control and write the value back through the setting.put channel.
 */

import { SPELL_LANGUAGES, spellLanguageName } from '../shared/spellcheck';
import { resolveLang } from '../main/menu-model';
import { getUiLanguage, setUiLanguage } from '../shared/ui-language';
import { preferenceText as t } from './preferences-i18n';

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

export {};

const invoke = <T = any>(method: string, ...args: unknown[]): Promise<T> =>
  window.JSBridge.invoke(method, ...args) as Promise<T>;

type Row =
  | { kind: 'check'; key: string; label: string }
  | { kind: 'radio'; key: string; value: string; label: string }
  | { kind: 'select'; key: string; label: string; options: [string, string][]; wide?: boolean }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; suffix?: string; presets?: [number, string][] }
  | { kind: 'text'; key: string; label: string; placeholder?: string }
  | { kind: 'button'; label: string; button: string; pending?: string; action: () => unknown }
  | { kind: 'note'; text: string }
  | { kind: 'hint'; text: string };

interface Group { title: string; rows: Row[]; searchTerms?: string }
interface Pane { id: string; title: string; build: (s: Record<string, any>) => Group[] }

let settings: Record<string, any> = {};
let themes: string[] = [];
let panes: Pane[] = [];
let currentPane = 'files';
let languageReadRevision = 0;

const themeOptions = (): [string, string][] =>
  (themes.length ? themes : ['github', 'night', 'newsprint', 'pixyll', 'whitey']).map((t) => [t, t]);

const L10N: [string, string][] = [
  ['auto', 'System Language'],
  ['zh', 'Simplified Chinese'],
  ['en', 'English'],
];

/* --------------------------------------------------------------- pane data */

function buildPanes(): Pane[] {
  return [
    {
      id: 'files',
      title: 'Files',
      build: () => [
        {
          title: 'On Launch',
          rows: [
            { kind: 'select', key: 'onLaunch', label: '', options: [
              ['new', 'Open new file'],
              ['folders', 'Restore last closed folders'],
              ['both', 'Restore last closed files and folders'],
              ['custom', 'Open custom folder'],
            ] },
            { kind: 'text', key: 'launchCustomFolder', label: 'Custom folder', placeholder: '/Users/…' },
          ],
        },
        { title: 'Outline', rows: [
          { kind: 'check', key: 'collapsibleOutline', label: 'Collapsible Outline on Left Panel' },
        ] },
        { title: 'Default File Type / Extension', rows: [
          { kind: 'select', key: 'defaultExtension', label: '', options: [
            ['.md', 'Markdown (.md)'],
            ['.markdown', 'Markdown (.markdown)'],
            ['.text', 'Text File (.text)'],
            ['custom', 'Custom'],
          ] },
          { kind: 'text', key: 'customExtension', label: 'Custom extension', placeholder: '.md' },
        ] },
        { title: 'Save & Recover', rows: [
          { kind: 'check', key: 'saveWithoutAsking', label: 'Save without asking when switch files on side panel' },
        ] },
        { title: 'Recent Locations', rows: [
          { kind: 'check', key: 'recordRecent', label: 'Record recent files and folders' },
          { kind: 'button', label: '', button: 'Clear Recent Folders and Files',
            action: () => invoke('setting.clearRecentDocuments') },
        ] },
        { title: 'When drop file / folder into Aropyt', rows: [
          { kind: 'select', key: 'actionWhenDropFolder', label: 'When drop folder', options: [
            ['open', 'Open in Aropyt'], ['link', 'Insert Folder Link'] ] },
          { kind: 'select', key: 'actionWhenDropFile', label: 'When drop markdown file', options: [
            ['open', 'Open in Aropyt'], ['link', 'Insert File Link'] ] },
          { kind: 'select', key: 'actionWhenDropImport', label: 'When drop files that can be imported', options: [
            ['import', 'Import File'], ['link', 'Insert File Link'] ] },
        ] },
      ],
    },

    {
      id: 'editor',
      title: 'Editor',
      build: () => [
        { title: '', rows: [{ kind: 'note', text: '(Some options will be applied after restart.)' }] },
        { title: 'Spell Check', searchTerms: '拼写检查 自动检测 语言 词典', rows: [
          { kind: 'note', text: 'Spelling dictionaries are not installed by default. Download a dictionary for the selected language or import local Hunspell .aff / .dic files. Document content is never uploaded.' },
          { kind: 'button', label: 'Offline spelling dictionaries', button: 'Download selected dictionary', pending: 'Downloading dictionary, please wait…', action: async () => { const result = await invoke('dictionary.installSelected'); if (result?.error) throw new Error(result.error); await notifyUser(t('Dictionary installed. Select a language to enable spell checking.')); } },
          { kind: 'button', label: 'Local dictionary', button: 'Import .aff / .dic', action: async () => { const result = await invoke('dictionary.importSelected'); if (result?.error) throw new Error(result.error); if (result) await notifyUser(t('Dictionary imported.')); } },
          { kind: 'button', label: 'Manage dictionaries', button: 'Open dictionary folder', action: () => invoke('dictionary.openFolder') },
          { kind: 'select', key: 'presetSpellCheck', label: 'Default spell check language', options: [
            ['auto', 'Auto Detect Language'], ['off', 'Disable Spell Check'], ...SPELL_LANGUAGES.map(([code]): [string, string] => [code, spellLanguageName(code, getUiLanguage())]) ] },
          { kind: 'check', key: 'spellcheckForCodeAndLink', label: 'Check spelling in code and links' },
        ] },
        { title: 'Indent Size on Save', rows: [
          { kind: 'hint', text: 'only apply to quotes and lists created from menu bar or hybrid view' },
          { kind: 'select', key: 'indentSize', label: '', options: [
            ['auto', 'Auto'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['tab', 'Tab'] ] },
          { kind: 'check', key: 'prettyIndent', label: 'Pretty indentation' },
        ] },
        { title: 'Auto Pair', rows: [
          { kind: 'check', key: 'autoPairBrackets', label: 'Auto pair brackets and quotes' },
          { kind: 'check', key: 'autoPairMarkdownSyntax', label: 'Auto pair common Markdown syntax' },
        ] },
        { title: 'Live Rendering', rows: [
          { kind: 'check', key: 'liveRenderSource',
            label: 'Display source for simple blocks (including headings, etc.) on focus' },
        ] },
        { title: 'Default Copy Behavior', rows: [
          { kind: 'hint', text: /Mac/i.test(navigator.platform) ? '(⌘C)' : '(Ctrl+C)' },
          { kind: 'check', key: 'copyMarkdownAsPlain', label: 'Copy Markdown source as plain text' },
          { kind: 'check', key: 'lineWiseCopyCut',
            label: 'Copy or cut the whole lines that have cursors on them, if there is no selection when doing' },
        ] },
        { title: 'Default Line Ending', rows: [
          { kind: 'hint', text: 'Line ending for new file' },
          { kind: 'radio', key: 'lineEndings', value: 'lf', label: 'LF (Unix Style)' },
          { kind: 'radio', key: 'lineEndings', value: 'crlf', label: 'CRLF (Windows Style)' },
        ] },
        { title: 'Typewriter Mode', rows: [
          { kind: 'check', key: 'typewriterKeepCaret',
            label: 'Always keep caret in middle of screen when typewriter mode is enabled' },
          { kind: 'button', label: '', button: 'Turn off Typewriter / Focus Mode',
            action: () => Promise.all([invoke('prefs.setMode', 'typewriter', false), invoke('prefs.setMode', 'focus', false)]) },
        ] },
      ],
    },

    {
      id: 'image',
      title: 'Image',
      build: () => [
        { title: 'When Insert…', rows: [
          { kind: 'select', key: 'actionWhenInsertImage', label: 'Learn More…', options: [
            ['none', 'No special action'],
            ['copy', 'Copy image to current folder (./)'],
            ['assets', 'Copy image to ./assets'],
            ['fileAssets', 'Copy image to ./${filename}.assets'],
            ['upload', 'Upload image'],
            ['custom', 'Copy image to custom folder'] ] },
          { kind: 'check', key: 'applyRulesToLocal', label: 'Apply above rules to local images' },
          { kind: 'check', key: 'applyRulesToOnline', label: 'Apply above rules to online images' },
          { kind: 'check', key: 'autoUploadByYaml',
            label: 'Allow typora-copy-images-to: upload in YAML to upload inserted images' },
        ] },
        { title: 'Preferred Image Syntax', rows: [
          { kind: 'check', key: 'relativePathWithDot', label: 'Use relative path if possible' },
          { kind: 'check', key: 'addDotSlash', label: 'Add ./ for relative path' },
          { kind: 'check', key: 'autoEscapeImageURL', label: 'Auto escape image URL when insert' },
        ] },
        { title: 'Image Upload Setting', rows: [
          { kind: 'select', key: 'imageUploader', label: 'Learn More…', options: [
            ['none', 'None'], ['ipic', 'iPic'], ['upic', 'uPic'], ['picsee', 'Picsee'],
            ['picgoCore', 'PicGo-Core (command line)'], ['picgoApp', 'PicGo.app'],
            ['piclist', 'PicList'], ['custom', 'Custom Command'] ] },
          { kind: 'button', label: '', button: 'Test Uploader', pending: 'Testing uploader…',
            action: async () => { const result = await invoke('images.testUploader'); if (result.error || !result.ok) throw new Error(result.error || result.message); await notifyUser(t('Upload test succeeded: ') + result.urls.join('\n')); } },
          { kind: 'text', key: 'imageUploadCommand', label: 'Uploader command' },
          { kind: 'note', text: 'iPic / uPic / Picsee require a configured command that prints an image URL. PicGo.app / PicList use their local HTTP service.' },
          { kind: 'text', key: 'imageUploadEndpoint', label: 'PicGo / PicList HTTP endpoint', placeholder: 'http://127.0.0.1:36677/upload' },
          { kind: 'text', key: 'imageCustomFolder', label: 'Custom image folder', placeholder: './assets' },
        ] },
      ],
    },

    {
      id: 'markdown',
      title: 'Markdown',
      build: () => [
        { title: '', rows: [
          { kind: 'note', text: 'Most settings apply immediately. Restart to apply changes to math packages and equation numbering.' } ] },
        { title: 'Syntax Preference', rows: [
          { kind: 'hint', text: 'only apply to quotes and lists created from menu bar or hybrid view' },
          { kind: 'check', key: 'strictMode', label: 'Strict Mode' },
          { kind: 'select', key: 'headingStyle', label: 'Heading style', options: [
            ['atx', 'atx (#)'], ['setext', 'setext (===)'],
            ['atxSuffix', 'atx with suffix (# ⋯ #)'],
            ['setextVar', 'variable-width setext (=====)'] ] },
          { kind: 'select', key: 'bulletChar', label: 'Bullet list marker', options: [
            ['-', '-'], ['+', '+'], ['*', '*'] ] },
          { kind: 'select', key: 'orderedDelimiter', label: 'Ordered list numbering', options: [
            ['increment', '1. ⋯ 2. ⋯ 3. ⋯'], ['repeat', '1. ⋯ 1. ⋯ 1. ⋯'] ] },
        ] },
        { title: 'Syntax Support', rows: [
          { kind: 'check', key: 'autoLinks', label: 'Auto Links (e.g: https://aropyt.io)' },
          { kind: 'check', key: 'inlineMath', label: 'Inline Math  (e.g: $\\LaTeX$)' },
          { kind: 'check', key: 'codeBlockMath', label: 'Code Block Math  (```math code block)' },
          { kind: 'check', key: 'subscript', label: 'Subscript    (e.g: H~2~O)' },
          { kind: 'check', key: 'superscript', label: 'Superscript (e.g: X^2^)' },
          { kind: 'check', key: 'highlight', label: 'Highlight     (e.g: ==key==)' },
          { kind: 'check', key: 'githubAlert', label: 'Github Style Alert' },
          { kind: 'check', key: 'diagrams', label: 'Diagrams' },
          { kind: 'hint', text: '(Sequence, Flowchart and Mermaid)' },
          { kind: 'select', key: 'diagramTheme', label: 'Diagram theme', options: [['default', 'Default'], ['neutral', 'Neutral'], ['dark', 'Dark'], ['forest', 'Forest']] },
          { kind: 'number', key: 'diagramFontSize', label: 'Diagram font size', min: 8, max: 40, step: 1, suffix: 'px' },
        ] },
        { title: 'Smart Punctuation', rows: [
          { kind: 'select', key: 'smartPunctuation', label: 'Learn More…', options: [
            ['input', 'Convert on Input'], ['render', 'Convert on Rendering'] ] },
          { kind: 'check', key: 'smartQuotes', label: 'Smart Quotes' },
          { kind: 'select', key: 'smartDoubleQuoteStyle', label: 'Double quote style', options: [
            ['“abc”', '“abc”'], ['„abc“', '„abc“'], ['„abc”', '„abc”'], ['”abc”', '”abc”'],
            ['«abc»', '«abc»'], ['« abc »', '« abc »'], ['»abc«', '»abc«'], ['"abc"', '"abc"'] ] },
          { kind: 'select', key: 'smartSingleQuoteStyle', label: 'Single quote style', options: [
            ['‘abc’', '‘abc’'], ['‚abc‘', '‚abc‘'], ['‚abc’', '‚abc’'], ['’abc’', '’abc’'],
            ['‹abc›', '‹abc›'], ['‹ abc ›', '‹ abc ›'], ['›abc‹', '›abc‹'], ["'abc'", "'abc'"] ] },
          { kind: 'check', key: 'smartDash', label: 'Smart Dashes' },
          { kind: 'check', key: 'remapPunctuation', label: 'Remap Unicode Punctuation on Parse' },
        ] },
        { title: 'Code Fences', rows: [
          { kind: 'check', key: 'fenceLineNumbers', label: 'Display line numbers for code fences' },
          { kind: 'check', key: 'fenceAutoWrap', label: 'Auto wrap long lines' },
          { kind: 'check', key: 'fenceShiftTabIndent', label: 'Use Shift+Tab to auto indent selected code' },
          { kind: 'select', key: 'codeIndentSize', label: 'Indent size', options: [
            ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'] ] },
          { kind: 'text', key: 'defaultCodeLang', label: 'Default Code Language', placeholder: '' },
          { kind: 'select', key: 'fenceLangWhen', label: 'Apply default language', options: [
            ['markdown', 'When add code fences via Markdown'],
            ['menubar', 'When add code fences via Menubar'],
            ['both', 'Both'] ] },
        ] },
        { title: 'Math', rows: [
          { kind: 'check', key: 'mathLineBreak', label: 'Apply Line Break at \\ and \\newline' },
          { kind: 'check', key: 'allowPhysicsConflict', label: 'Enable physics package' },
          { kind: 'select', key: 'autoNumberingForMath', label: 'Equation numbering', options: [
            ['none', 'No Automatic Equation Numbering'],
            ['ams', 'Use AMS Numbering Rules'],
            ['all', 'Auto Numbering for All Math Equations'] ] },
          { kind: 'select', key: 'mathCopyFormat', label: 'Math format on copy', options: [
            ['svg', 'Use Rendered SVG'], ['latex', 'Use LaTeX Source'] ] },
          { kind: 'button', label: '', button: 'Enable inline math or code block math',
            action: () => { renderPane('markdown'); document.querySelector<HTMLInputElement>('[data-key="inlineMath"]')?.focus(); } },
        ] },
        { title: 'Whitespace / Line Break', rows: [
          { kind: 'check', key: 'indentFirstLine', label: 'Indent first line of paragraphs' },
          { kind: 'check', key: 'visibleBr', label: 'Visible <br/>' },
          { kind: 'select', key: 'whitespaceOnEdit', label: 'In editor', options: [
            ['preserve', 'Preserve sequential whitespace and single line break'],
            ['ignore', 'Ignore sequential whitespace and single line break'] ] },
          { kind: 'select', key: 'whitespaceOnExport', label: 'On export', options: [
            ['preserve', 'Preserve sequential whitespace and single line break'],
            ['ignore', 'Ignore sequential whitespace and single line break'] ] },
        ] },
      ],
    },

    {
      id: 'export',
      title: 'Export',
      build: () => [
        { title: 'General', rows: [
          { kind: 'hint', text: 'PDF · HTML · HTML (without Styles) · Image · Word (.docx) · OpenOffice · RTF · Epub · LaTeX · Media Wiki · reStructuredText · Textile · OPML' },
          { kind: 'select', key: 'exportFolder', label: 'Default Folder for Exported File', options: [
            ['auto', 'Auto'], ['same', 'Same folder with current file'], ['custom', 'Custom location'] ] },
          { kind: 'text', key: 'exportCustomFolder', label: 'Custom export folder', placeholder: '/Users/…' },
          { kind: 'text', key: 'pandocPath', label: 'Pandoc Path', placeholder: '' },
          { kind: 'check', key: 'openAfterExport', label: 'Open exported file location' },
        ] },
        { title: 'PDF', rows: [
          { kind: 'select', key: 'exportPaperSize', label: 'Paper size', options: [
            ['A4', 'A4'], ['A5', 'A5'], ['US Letter', 'US Letter'],
            ['US Legal', 'US Legal'], ['Tabloid', 'Tabloid'] ] },
          { kind: 'number', key: 'exportMargin', label: 'Margin', min: 0, max: 60, step: 1, suffix: 'mm' },
          { kind: 'check', key: 'preLinebreakOnExport', label: 'Preserve line breaks on export' },
        ] },
      ],
    },

    {
      id: 'appearance',
      title: 'Appearance',
      build: () => [
        { title: 'Font Size', rows: [
          { kind: 'radio', key: 'fontSizeMode', value: 'auto', label: 'Auto ( Recommended )' },
          { kind: 'radio', key: 'fontSizeMode', value: 'custom', label: 'Customized' },
          { kind: 'number', key: 'customFontSize', label: '', min: 10, max: 32, step: 1, suffix: 'px' },
        ] },
        { title: 'Zoom', rows: [
          { kind: 'check', key: 'zoomByMouse', label: 'Allow magnification by mouse (Ctrl + scroll)' },
        ] },
        { title: 'Word Count', searchTerms: '字数统计 总是显示 阅读速度 词数 字符 行数', rows: [
          { kind: 'check', key: 'showWordCount', label: 'Show word count in status bar' },
          { kind: 'number', key: 'readingSpeed', label: 'Reading speed', min: 1, max: 999, step: 1, suffix: 'words per minute',
            presets: [[120, '120 words/minute (Slow)'], [240, '240 words/minute (Medium)'], [382, '382 words/minute (Fast)']] },
          { kind: 'button', label: '', button: 'Reset reading speed', action: () => put('readingSpeed', 382).then(() => renderPane(currentPane)) },
        ] },
        { title: 'Themes', rows: [
          { kind: 'select', key: 'theme', label: 'Theme', options: themeOptions(), wide: true },
          { kind: 'button', label: '', button: 'Open Theme Folder',
            action: () => invoke('theme.openFolder') },
          { kind: 'note', text: 'Install a theme by copying its CSS and assets into the theme folder.' },
        ] },
      ],
    },

    {
      id: 'general',
      title: 'General',
      build: () => [
        { title: 'Language', rows: [
          { kind: 'select', key: 'menuLanguage', label: '', options: L10N },
          { kind: 'note', text: 'Applied immediately — no restart needed.' },
        ] },
        { title: 'Registration / Activation', rows: [
          { kind: 'note', text: 'Aropyt is a local replica and has no activation, licence server or updater.' },
          { kind: 'button', label: '', button: 'About Aropyt',
            action: () => invoke('window.about') },
        ] },
        { title: 'Shortcut Keys', rows: [
          { kind: 'button', label: 'Key bindings are read from conf.user.json → keyBinding.',
            button: 'Open Config Folder', action: () => invoke('setting.openConfFolder') },
        ] },
        { title: 'Advanced Settings', rows: [
          { kind: 'check', key: 'debugMode', label: 'Enable debug mode' },
          { kind: 'button', label: '', button: 'Open User Data Folder',
            action: () => invoke('setting.openUserDataFolder') },
        ] },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ render */

async function notifyUser(message: string, type: 'info' | 'error' = 'info'): Promise<void> {
  await invoke('dialog.showMessageBox', { type, title: t('Preferences'), message, buttons: [t('OK')], defaultId: 0, cancelId: 0 });
}

function buildRow(row: Row, groupTitle: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pref-row';

  if (row.kind === 'note' || row.kind === 'hint') {
    el.classList.add('is-stacked');
    const p = document.createElement('p');
    p.className = row.kind === 'note' ? 'pref-note' : 'pref-hint-line';
    p.textContent = t(row.text);
    el.appendChild(p);
    return el;
  }

  // Controls without a label sit as a block under their group title, and
  // Checkboxes and radios are drawn to the left of their text.
  if (!row.label && (row.kind === 'select' || row.kind === 'button' || row.kind === 'number')) {
    el.classList.add('is-block');
  }
  if (row.kind === 'check' || row.kind === 'radio') {
    el.classList.add('is-check');
  }

  const labelBox = document.createElement('div');
  labelBox.className = 'pref-label';
  const text = row.kind === 'button' ? row.label || '' : row.label;
  if (text) {
    const name = document.createElement('span');
    name.className = 'pref-name';
    name.textContent = t(text);
    labelBox.appendChild(name);
  }
  el.appendChild(labelBox);

  const control = document.createElement('div');
  control.className = 'pref-control';

  if (row.kind === 'check') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'pref-check';
    input.checked = !!settings[row.key];
    input.addEventListener('change', () => void put(row.key, input.checked));
    control.appendChild(input);
  } else if (row.kind === 'radio') {
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'pref-check';
    input.name = 'radio-' + row.key;
    input.checked = String(settings[row.key] ?? '') === row.value;
    input.addEventListener('change', () => {
      if (!input.checked) return;
      void put(row.key, row.value);
      renderPane(currentPane);
    });
    control.appendChild(input);
  } else if (row.kind === 'select') {
    const select = document.createElement('select');
    select.className = 'pref-select' + (row.wide ? ' wide' : '');
    for (const [value, label] of row.options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = row.key === 'theme' ? label : t(label);
      select.appendChild(opt);
    }
    const cur = settings[row.key];
    if (cur !== undefined && cur !== null) select.value = String(cur);
    if (!select.value && row.options.length) select.value = row.options[0][0];
    select.addEventListener('change', () => {
      void put(row.key, select.value);
      if (row.key === 'theme') void invoke('prefs.themeChanged');
    });
    control.appendChild(select);
  } else if (row.kind === 'number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'pref-number';
    if (row.min !== undefined) input.min = String(row.min);
    if (row.max !== undefined) input.max = String(row.max);
    input.step = String(row.step ?? 1);
    const cur = settings[row.key];
    input.value = cur === undefined || cur === null ? '' : String(cur);
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (input.value && input.checkValidity() && Number.isFinite(n)) void put(row.key, n);
      else input.value = String(settings[row.key] ?? '');
    });
    control.appendChild(input);
    if (row.presets) {
      const list = document.createElement('datalist'); list.id = 'presets-' + row.key;
      for (const [value, label] of row.presets) {
        const option = document.createElement('option'); option.value = String(value); option.label = t(label); list.append(option);
      }
      input.setAttribute('list', list.id); control.append(list);
    }
    if (row.suffix) {
      const s = document.createElement('span');
      s.className = 'pref-suffix';
      s.textContent = t(row.suffix);
      control.appendChild(s);
    }
  } else if (row.kind === 'text') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pref-text';
    if (row.placeholder) input.placeholder = t(row.placeholder);
    const cur = settings[row.key];
    input.value = cur === undefined || cur === null ? '' : String(cur);
    input.addEventListener('change', () => void put(row.key, input.value));
    control.appendChild(input);
  } else {
    const btn = document.createElement('button');
    btn.className = 'pref-btn';
    btn.textContent = t(row.button);
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      if (row.pending) btn.textContent = t(row.pending);
      try { await row.action(); }
      catch (error) { await notifyUser(t('Operation failed: ') + (error instanceof Error ? error.message : String(error)), 'error'); }
      finally { btn.disabled = false; btn.textContent = t(row.button); }
    });
    control.appendChild(btn);
  }

  for (const field of control.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')) {
    field.setAttribute('aria-label', t(row.label || groupTitle));
    if ('key' in row) field.dataset.key = row.key;
    if (row.kind === 'radio') field.value = row.value;
  }
  el.appendChild(control);
  return el;
}

async function put(key: string, value: unknown): Promise<void> {
  settings[key] = value;
  await invoke('setting.put', key, value);
  if (key === 'menuLanguage') await refreshLanguageFromSettings();
  if (key === 'theme') await invoke('prefs.themeChanged');
  if (key === 'showStatusBar') await invoke('prefs.applyChrome');
}

type PreferenceField = HTMLInputElement | HTMLSelectElement;
function updateControl(key: string, value: unknown): void {
  for (const field of document.querySelectorAll<PreferenceField>('[data-key]')) {
    if (field.dataset.key !== key) continue;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = !!value;
    else if (field instanceof HTMLInputElement && field.type === 'radio') field.checked = field.value === String(value);
    else if (document.activeElement !== field) field.value = String(value ?? '');
  }
}

async function refreshLanguageFromSettings(): Promise<void> {
  const revision = ++languageReadRevision;
  const current = await invoke<Record<string, any>>('setting.getAll');
  if (revision !== languageReadRevision) return;
  // Notifications can arrive out of write order; the stored value is authoritative.
  settings.menuLanguage = current?.menuLanguage ?? 'auto';
  refreshLanguage();
}

/** Translate in place: replacing a focused input can collapse its native WebKit selection. */
function translateCurrentPane(): void {
  const host = document.getElementById('pref-content');
  if (!host?.children.length) { renderPane(currentPane); return; }
  const pane = panes.find(item => item.id === currentPane) ?? panes[0];
  const groups = pane.build(settings), query = searchQuery();
  for (const [index, group] of groups.entries()) {
    const box = host.children[index] as HTMLElement;
    const heading = box.querySelector('h4');
    if (heading) heading.textContent = t(group.title);
    box.classList.toggle('pref-search-match', !!query && groupMatches(group, query));
    const rows = box.querySelectorAll<HTMLElement>('.pref-row');
    for (const [rowIndex, row] of group.rows.entries()) {
      const element = rows[rowIndex];
      if (row.kind === 'note' || row.kind === 'hint') {
        element.querySelector('.pref-note, .pref-hint-line')!.textContent = t(row.text);
        continue;
      }
      const label = element.querySelector('.pref-name');
      if (label) label.textContent = t(row.label);
      for (const field of element.querySelectorAll<PreferenceField>('input,select')) {
        field.setAttribute('aria-label', t(row.label || group.title));
      }
      if (row.kind === 'select') {
        const select = element.querySelector('select')!;
        for (const option of select.options) {
          const label = row.options.find(([value]) => value === option.value)?.[1];
          if (label !== undefined) option.textContent = row.key === 'theme' ? label : t(label);
        }
        if (row.key === 'menuLanguage') select.value = String(settings.menuLanguage ?? 'auto');
      } else if (row.kind === 'number') {
        const suffix = element.querySelector('.pref-suffix');
        if (suffix && row.suffix) suffix.textContent = t(row.suffix);
        for (const option of element.querySelectorAll<HTMLOptionElement>('datalist option')) {
          const label = row.presets?.find(([value]) => String(value) === option.value)?.[1];
          if (label !== undefined) option.label = t(label);
        }
      } else if (row.kind === 'text') {
        if (row.placeholder) element.querySelector('input')!.placeholder = t(row.placeholder);
      } else if (row.kind === 'button') {
        const button = element.querySelector('button')!;
        button.textContent = t(button.disabled && row.pending ? row.pending : row.button);
      }
    }
  }
}

function refreshLanguage(): void {
  const language = resolveLang(navigator.language, settings.menuLanguage);
  const main = document.querySelector<HTMLElement>('.pref-main');
  const scrollTop = main?.scrollTop ?? 0;
  setUiLanguage(language);
  panes = buildPanes();
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = t('Preferences');
  for (const item of document.querySelectorAll<HTMLElement>('.pref-nav-item')) {
    item.textContent = t(panes.find(pane => pane.id === item.dataset.pane)?.title || '');
  }
  const search = document.getElementById('pref-search') as HTMLInputElement | null;
  if (search) { search.placeholder = t('Search for...'); search.setAttribute('aria-label', t('Search for...')); }
  translateCurrentPane();
  const query = searchQuery();
  for (const item of document.querySelectorAll<HTMLElement>('.pref-nav-item')) {
    const pane = panes.find(pane => pane.id === item.dataset.pane);
    item.classList.toggle('pref-search-muted', !!query && !!pane &&
      !(pane.title + ' ' + t(pane.title)).toLocaleLowerCase().includes(query) &&
      !pane.build(settings).some(group => groupMatches(group, query)));
  }
  if (main) main.scrollTop = scrollTop;
}

function renderPane(id: string): void {
  currentPane = id;
  const pane = panes.find((p) => p.id === id) ?? panes[0];
  const query = searchQuery();
  for (const item of document.querySelectorAll<HTMLElement>('.pref-nav-item')) item.classList.toggle('active', item.dataset.pane === pane.id);
  const host = document.getElementById('pref-content');
  if (!host) return;
  host.innerHTML = '';
  for (const group of pane.build(settings)) {
    const box = document.createElement('div');
    box.className = 'pref-group';
    box.classList.toggle('pref-search-match', !!query && groupMatches(group, query));
    if (group.title) {
      const h = document.createElement('h4');
      h.textContent = t(group.title);
      box.appendChild(h);
    }
    for (const row of group.rows) box.appendChild(buildRow(row, group.title));
    host.appendChild(box);
  }
}

function searchQuery(): string {
  return (document.getElementById('pref-search') as HTMLInputElement | null)?.value.trim().toLocaleLowerCase() || '';
}
function groupMatches(group: Group, query: string): boolean {
  // Search both language forms, so switching languages does not invalidate a query.
  return JSON.stringify(group, (_key, value) => typeof value === 'string'
    ? value + ' ' + t(value, 'zh') : value).toLocaleLowerCase().includes(query);
}
function searchPreferences(): void {
  const query = searchQuery();
  const matching = panes.filter((pane) => (pane.title + ' ' + t(pane.title)).toLocaleLowerCase().includes(query) || pane.build(settings).some((group) => groupMatches(group, query)));
  for (const item of document.querySelectorAll<HTMLElement>('.pref-nav-item')) {
    item.classList.toggle('pref-search-muted', !!query && !matching.some((pane) => pane.id === item.dataset.pane));
  }
  const target = matching.some((pane) => pane.id === currentPane) ? currentPane : matching[0]?.id || currentPane;
  renderPane(target);
  document.querySelector('.pref-search-match')?.scrollIntoView({ block: 'nearest' });
}

function selectActiveField(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return false;
  if (active instanceof HTMLInputElement && !['text', 'search', 'url', 'email', 'password', 'tel', 'number'].includes(active.type)) return false;
  active.select();
  return true;
}

function installFieldShortcuts(): void {
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
    const primary = /Mac/i.test(navigator.platform) ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (primary && event.key.toLowerCase() === 'a' && selectActiveField()) event.preventDefault();
  }, true);
}

/* ------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  installFieldShortcuts();
  settings = (await invoke<Record<string, any>>('setting.getAll')) ?? {};
  themes = (await invoke<string[]>('setting.getThemes')) ?? [];
  refreshLanguage();

  const isDark = await invoke<boolean>('theme.isDark');
  document.body.classList.toggle('dark', !!isDark);
  document.body.classList.toggle('light', !isDark);

  for (const item of Array.from(document.querySelectorAll<HTMLElement>('.pref-nav-item'))) {
    item.addEventListener('click', () => {
      for (const other of Array.from(document.querySelectorAll('.pref-nav-item'))) other.classList.remove('active');
      item.classList.add('active');
      renderPane(item.dataset.pane ?? 'files');
    });
  }

  const search = document.getElementById('pref-search') as HTMLInputElement | null;
  search?.addEventListener('input', searchPreferences);
  search?.addEventListener('keydown', (event) => { if (event.key === 'Escape') { search.value = ''; searchPreferences(); } });

  const initialPane = new URLSearchParams(location.search).get('pane') || 'files';
  renderPane(initialPane);
  for (const item of Array.from(document.querySelectorAll<HTMLElement>('.pref-nav-item'))) item.classList.toggle('active', item.dataset.pane === initialPane);
  window.JSBridge.on((event) => {
    if (event.type === 'menu' && event.arg?.action === 'close') { void invoke('window.close'); return; }
    if (event.type === 'menu' && event.arg?.action === 'setMenuLanguage') { void put('menuLanguage', event.arg.arg); return; }
    if (event.type === 'menu' && event.arg?.action === 'selectAll') { selectActiveField(); return; }
    if (event.type === 'menu' && ['undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain'].includes(event.arg?.action)) {
      void invoke(event.arg.action === 'pastePlain' ? 'webContents.pastePlain' : 'webContents.' + event.arg.action);
      return;
    }
    if (event.type === 'setting-changed' && event.arg?.key) {
      if (event.arg.key === 'menuLanguage') {
        void refreshLanguageFromSettings().catch(error => notifyUser(t('Operation failed: ') + String(error), 'error'));
      } else {
        settings[event.arg.key] = event.arg.value;
        updateControl(event.arg.key, event.arg.value);
      }
      return;
    }
    if (event.type !== 'preferences-pane') return;
    renderPane(String(event.arg));
    for (const item of Array.from(document.querySelectorAll<HTMLElement>('.pref-nav-item'))) item.classList.toggle('active', item.dataset.pane === event.arg);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  void boot().catch((err) => {
    const host = document.getElementById('pref-content');
    if (host) host.textContent = t('Failed to load preferences: ') + String(err);
  });
});
