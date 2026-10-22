import { app, Menu, MenuItemConstructorOptions, loadSettings, clearRecentFiles, platform } from './menu-host';
const path = { basename: (p: string) => p.split(/[\\/]/).pop() || '' };
import { ACCEL, Lang, LangPref, LabelKey, RENDERER_KEYS, pick, resolveLang } from '../main/menu-model';

export type CommandSender = (action: string, arg?: unknown) => void;

interface MenuCtx {
  send: CommandSender;
  listThemes: () => string[];
  currentTheme: () => string;
  openFile: (file: string) => void;
}

function detectLang(): Lang {
  const pref = loadSettings().menuLanguage as LangPref | undefined;
  return resolveLang(app.getLocale() || 'en', pref);
}

/** Theme files are lowercase; Aropyt's menu shows them capitalised. */
function themeLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function buildMenu(ctx: MenuCtx): Menu {
  const s = loadSettings();
  const lang = detectLang();
  const t = (key: LabelKey): string => pick(lang, key);

  const item = (
    label: string,
    action: string,
    accel?: string,
    arg?: unknown,
    extra: Partial<MenuItemConstructorOptions> = {},
  ): MenuItemConstructorOptions => ({
    label,
    accelerator: accel ? toElectronAccel(accel) : undefined,
    // Editing shortcuts belong to the renderer, which owns the selection.
    registerAccelerator: accel ? !RENDERER_KEYS.has(accel) : undefined,
    click: () => ctx.send('menu', { action, arg }),
    ...extra,
  });

  const sep: MenuItemConstructorOptions = { type: 'separator' };

  const recent: MenuItemConstructorOptions[] = (s.recentFiles || []).slice(0, 12).map((f: string) => ({
    label: path.basename(f),
    click: () => ctx.openFile(f),
  }));
  if (!recent.length) recent.push({ label: t('noRecent'), enabled: false });

  const recentMenu: MenuItemConstructorOptions[] = [
    { label: t('recentFiles'), submenu: recent },
    {
      label: t('recentLocations'),
      submenu: (s.recentFolders || []).slice(0, 12).map((d: string): MenuItemConstructorOptions => ({
        label: path.basename(d) || d,
        click: () => ctx.send('menu', { action: 'openFolder', arg: d }),
      })),
    },
    sep,
    {
      label: t('clearItems'),
      click: () => {
        clearRecentFiles();
        buildMenu(ctx);
      },
    },
  ];

  const themeItems: MenuItemConstructorOptions[] = ctx.listThemes().map((name) => ({
    label: themeLabel(name),
    type: 'radio' as const,
    checked: name === ctx.currentTheme(),
    click: () => ctx.send('menu', { action: 'setTheme', arg: name }),
  }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: t('file'),
      submenu: [
        item(t('newFile'), 'new', ACCEL.newFile),
        item(t('newTab'), 'newTab', 'Ctrl+T'),
        item(t('newWindow'), 'newWindow', ACCEL.newWindow),
        sep,
        item(t('open'), 'open', ACCEL.open),
        item(t('openFolder'), 'openFolder'),
        sep,
        item(t('openQuickly'), 'openQuickly', ACCEL.openQuickly),
        { label: t('openRecent'), submenu: recentMenu },
        {
          label: t('reopenEncoding'),
          submenu: [
            item(t('encAuto'), 'reopenEncoding', undefined, 'auto'),
            sep,
            item(t('encUtf8'), 'reopenEncoding', undefined, 'utf-8'),
            item(t('encUtf16le'), 'reopenEncoding', undefined, 'utf16le'),
            item(t('encUtf16be'), 'reopenEncoding', undefined, 'utf16be'),
            sep,
            item(t('encGb18030'), 'reopenEncoding', undefined, 'gb18030'),
            item(t('encBig5'), 'reopenEncoding', undefined, 'big5'),
            item(t('encShiftJis'), 'reopenEncoding', undefined, 'shift_jis'),
            item(t('encEucKr'), 'reopenEncoding', undefined, 'euc-kr'),
            sep,
            item(t('encLatin1'), 'reopenEncoding', undefined, 'latin1'),
            item(t('encWin1252'), 'reopenEncoding', undefined, 'win1252'),
          ],
        },
        sep,
        item(t('save'), 'save', ACCEL.save),
        item(t('saveAs'), 'saveAs', ACCEL.saveAs),
        item(t('moveTo'), 'moveTo'),
        item(t('saveAll'), 'saveAll'),
        sep,
        item(t('properties'), 'properties'),
        item(t('openLocation'), 'openFileLocation'),
        item(t('revealInSidebar'), 'revealInSidebar'),
        item(t('deleteFile'), 'deleteFile'),
        sep,
        item(t('import'), 'import'),
        {
          label: t('export'),
          submenu: [
            item(t('exportHtml'), 'export:html'),
            item(t('exportHtmlPlain'), 'export:html-plain'),
            item(t('exportPdf'), 'export:pdf'),
            item(t('exportImage'), 'export:image'),
            sep,
            item(t('exportDocx'), 'export:docx'),
            item(t('exportOdt'), 'export:odt'),
            item(t('exportLatex'), 'export:latex'),
            item(t('exportEpub'), 'export:epub'),
            sep,
            item(t('exportOther'), 'export:other'),
            item(t('exportSetting'), 'exportSetting'),
          ],
        },
        item(t('print'), 'print', ACCEL.print),
        sep,
        item(t('preferences'), 'preferences', ACCEL.preferences),
        sep,
        item(t('close'), 'close', ACCEL.close),
      ],
    },
    {
      label: t('edit'),
      submenu: [
        item(t('undo'), 'undo', ACCEL.undo),
        item(t('redo'), 'redo', ACCEL.redo),
        sep,
        { label: t('cut'), role: 'cut', accelerator: toElectronAccel(ACCEL.cut) },
        { label: t('copy'), role: 'copy', accelerator: toElectronAccel(ACCEL.copy) },
        item(t('copyImage'), 'copyImage'),
        { label: t('paste'), role: 'paste', accelerator: toElectronAccel(ACCEL.paste) },
        sep,
        item(t('copyPlain'), 'copyPlain'),
        item(t('copyMarkdown'), 'copyAsMarkdown', ACCEL.copyMarkdown),
        item(t('copyHtml'), 'copyAsHtmlCode'),
        item(t('copySimple'), 'copySimple'),
        sep,
        { label: t('pastePlain'), role: 'pasteAndMatchStyle', accelerator: toElectronAccel(ACCEL.pastePlain) },
        sep,
        {
          label: t('select'),
          submenu: [
            item(t('selectAll'), 'selectAll', 'Ctrl+A'),
            item(t('selectBlock'), 'selectBlock'),
            item(t('selectLine'), 'selectLine'),
            item(t('selectStyled'), 'selectStyled'),
            item(t('selectWord'), 'selectWord'),
          ],
        },
        sep,
        item(t('del'), 'del'),
        {
          label: t('deleteRange'),
          submenu: [
            item(t('deleteBlock'), 'deleteBlock'),
            item(t('deleteLine'), 'deleteLine', 'Ctrl+Alt+Shift+L'),
            item(t('deleteStyled'), 'deleteStyled'),
            item(t('deleteWord'), 'deleteWord'),
          ],
        },
        sep,
        {
          label: t('mathTools'),
          submenu: [
            item(t('refreshMath'), 'refreshMath'),
          ],
        },
        sep,
        {
          label: t('smartPunct'),
          submenu: [
            item(t('smartQuotes'), 'smartQuotes'),
            item(t('smartDash'), 'smartDash'),
          ],
        },
        item(t('lineEndings'), 'lineEndings'),
        item(t('spacesBreaks'), 'spacesBreaks'),
        item(t('spellCheck'), 'spellCheck'),
        sep,
        {
          label: t('findReplace'),
          submenu: [
            item(t('find'), 'find', 'Ctrl+F'),
            item(t('replace'), 'replace', 'Ctrl+H'),
          ],
        },
        sep,
        item(t('emoji'), 'emoji'),
      ],
    },
    {
      label: t('paragraph'),
      submenu: [
        item(t('h1'), 'heading:1', ACCEL.h1),
        item(t('h2'), 'heading:2', ACCEL.h2),
        item(t('h3'), 'heading:3', ACCEL.h3),
        item(t('h4'), 'heading:4', ACCEL.h4),
        item(t('h5'), 'heading:5', ACCEL.h5),
        item(t('h6'), 'heading:6', ACCEL.h6),
        sep,
        item(t('paragraph'), 'heading:0', ACCEL.paragraph),
        sep,
        item(t('headingUp'), 'headingUp', ACCEL.headingUp),
        item(t('headingDown'), 'headingDown', ACCEL.headingDown),
        sep,
        {
          label: t('table'),
          submenu: [
            item(t('insertTable'), 'insertTable'),
            sep,
            item(t('tableRowBefore'), 'tableRowBefore'),
            item(t('tableRowAfter'), 'tableRowAfter', 'Ctrl+Enter'),
            item(t('tableDeleteRow'), 'tableDeleteRow', 'Ctrl+Shift+Backspace'),
            sep,
            item(t('tableColumnBefore'), 'tableColumnBefore'),
            item(t('tableColumnAfter'), 'tableColumnAfter'),
            item(t('tableDeleteColumn'), 'tableDeleteColumn'),
            sep,
            item(t('copyTable'), 'copyTable'),
            item(t('deleteTable'), 'deleteTable'),
          ],
        },
        item(t('mathBlock'), 'insertMathBlock', ACCEL.mathBlock),
        item(t('codeFences'), 'insertFences', ACCEL.codeFences),
        {
          label: t('codeTools'),
          submenu: [
            item(t('copyCode'), 'copyCode'),
            item(t('prettifyCode'), 'prettifyCode'),
          ],
        },
        {
          label: t('alert'),
          submenu: [
            item(t('alertNote'), 'alert:note'),
            item(t('alertTip'), 'alert:tip'),
            item(t('alertImportant'), 'alert:important'),
            item(t('alertWarning'), 'alert:warning'),
            item(t('alertCaution'), 'alert:caution'),
          ],
        },
        sep,
        item(t('quote'), 'insertQuote', ACCEL.quote),
        sep,
        item(t('ol'), 'insertOrderedList', ACCEL.ol),
        item(t('ul'), 'insertUnorderedList', ACCEL.ul),
        item(t('taskList'), 'insertTaskList', ACCEL.taskList),
        {
          label: t('taskStatus'),
          submenu: [
            item(t('taskDone'), 'taskDone'),
            item(t('taskTodo'), 'taskTodo'),
          ],
        },
        {
          label: t('listIndent'),
          submenu: [item(t('indent'), 'indent'), item(t('outdent'), 'outdent')],
        },
        sep,
        item(t('paraBefore'), 'insertParagraphBefore'),
        item(t('paraAfter'), 'insertParagraphAfter'),
        sep,
        item(t('linkRef'), 'insertLinkRef'),
        item(t('footnote'), 'insertFootnote'),
        sep,
        item(t('hr'), 'insertHr'),
        item(t('toc'), 'insertToc'),
        item(t('frontMatter'), 'insertFrontMatter'),
      ],
    },
    {
      label: t('format'),
      submenu: [
        item(t('bold'), 'strong', ACCEL.bold),
        item(t('italic'), 'emphasis', ACCEL.italic),
        item(t('underline'), 'underline', ACCEL.underline),
        item(t('code'), 'inlineCode', ACCEL.code),
        sep,
        item(t('inlineMath'), 'inlineMath'),
        item(t('strike'), 'strike', ACCEL.strike),
        item(t('comment'), 'comment'),
        sep,
        item(t('link'), 'link', ACCEL.link),
        {
          label: t('linkActions'),
          submenu: [
            item(t('openLink'), 'openLink'),
            item(t('copyLink'), 'copyLink'),
          ],
        },
        {
          label: t('image'),
          submenu: [
            item(t('insertImage'), 'insertImage'),
            item(t('insertLocalImages'), 'insertLocalImages'),
            item(t('uploadAllImages'), 'uploadAllImages'),
          ],
        },
        sep,
        item(t('clearFormat'), 'clearFormat', ACCEL.clearFormat),
      ],
    },
    {
      label: t('view'),
      submenu: [
        item(t('toggleSidebar'), 'toggleSidebar', ACCEL.toggleSidebar),
        item(t('outline'), 'toggleOutline', ACCEL.outline),
        item(t('fileList'), 'showFileList', ACCEL.fileList),
        item(t('fileTree'), 'showFileTree', ACCEL.fileTree),
        item(t('search'), 'sidebarSearch', ACCEL.search),
        sep,
        item(t('sourceMode'), 'toggleSource', ACCEL.sourceMode),
        sep,
        item(t('focusMode'), 'toggleFocus', ACCEL.focusMode),
        item(t('typewriterMode'), 'toggleTypewriter', ACCEL.typewriterMode),
        sep,
        item(t('showStatusBar'), 'toggleStatusBar', undefined, undefined, {
          type: 'checkbox' as const,
          checked: s.showStatusBar !== false,
        }),
        item(t('wordCountWindow'), 'toggleWordCount'),
        sep,
        item(t('toggleFullscreen'), 'toggleFullScreen', ACCEL.toggleFullscreen),
        item(t('alwaysOnTop'), 'toggleAlwaysOnTop'),
        sep,
        item(t('actualSize'), 'zoomReset', ACCEL.actualSize),
        item(t('zoomIn'), 'zoomIn', ACCEL.zoomIn),
        item(t('zoomOut'), 'zoomOut', ACCEL.zoomOut),
        sep,
        item(t('switchTab'), 'switchTab', ACCEL.switchTab),
        sep,
        item(t('devTools'), 'toggleDevTools', ACCEL.devTools),
      ],
    },
    {
      label: t('themes'),
      submenu: [
        ...themeItems,
        sep,
        item(t('openThemeFolder'), 'openThemeFolder'),
      ],
    },
    {
      label: t('help'),
      submenu: [
        item(t('quickStart'), 'help:quickstart'),
        item(t('markdownReference'), 'help:markdown'),
        item(t('pandocGuide'), 'help:pandoc'),
        item(t('customThemes'), 'help:themes'),
        item(t('useImages'), 'help:images'),
        item(t('recovery'), 'help:recovery'),
        item(t('moreThemes'), 'help:moreThemes'),
        sep,
        item(t('credits'), 'help:credits'),
        item(t('changeLog'), 'help:changelog'),
        item(t('privacy'), 'help:privacy'),
        item(t('projectRepository'), 'help:repository'),
        item(t('license'), 'help:license'),
        item(t('about'), 'about'),
        sep,
        // Language switch
        {
          label: t('language'),
          submenu: [
            {
              label: t('langAuto'),
              type: 'radio' as const,
              checked: !loadSettings().menuLanguage || loadSettings().menuLanguage === 'auto',
              click: () => ctx.send('menu', { action: 'setMenuLanguage', arg: 'auto' }),
            },
            {
              label: t('langZh'),
              type: 'radio' as const,
              checked: loadSettings().menuLanguage === 'zh',
              click: () => ctx.send('menu', { action: 'setMenuLanguage', arg: 'zh' }),
            },
            {
              label: t('langEn'),
              type: 'radio' as const,
              checked: loadSettings().menuLanguage === 'en',
              click: () => ctx.send('menu', { action: 'setMenuLanguage', arg: 'en' }),
            },
          ],
        },
      ],
    },
  ];

  if (platform === 'darwin') template.splice(template.length - 1, 0, {
    role: 'windowMenu', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, sep, { role: 'toggleTabBar' },
      { role: 'selectPreviousTab' }, { role: 'selectNextTab' }, { role: 'showAllTabs' },
      { role: 'moveTabToNewWindow' }, { role: 'mergeAllWindows' }, sep, { role: 'front' },
    ],
  });
  if (platform === 'darwin') template.unshift({
    label: 'Aropyt',
    submenu: [
      { role: 'about' }, sep,
      item(t('preferences'), 'preferences', ACCEL.preferences), sep,
      { role: 'services' }, sep,
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep,
      { role: 'quit' },
    ],
  });
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

/** Translates our display accelerators into Electron's syntax. */
function toElectronAccel(accel: string): string {
  return platform === 'darwin' ? accel.replace(/^Ctrl\+/, 'CommandOrControl+') : accel;
}

export function menuLanguage(): Lang {
  return detectLang();
}
