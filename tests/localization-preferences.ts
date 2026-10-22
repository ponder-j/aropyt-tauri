import { PREFERENCE_TRANSLATIONS } from '../src/renderer/preferences-i18n';
import { SPELL_LANGUAGES, spellLanguageName } from '../src/shared/spellcheck';
import { resolveLang, type Lang } from '../src/main/menu-model';

type PreferencesWindow = Window & { JSBridge: { invoke(method: string, ...args: unknown[]): Promise<any> } };
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function waitFor(checkReady: () => boolean): Promise<void> {
  for (let n = 0; n < 200; n++) {
    if (checkReady()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for translated preferences');
}

/** Runs against the real Preferences document, including the cross-window settings event. */
export async function runPreferencesLocalizationChecks(target: Window = window): Promise<string[]> {
  const w = target as PreferencesWindow, doc = w.document;
  await waitFor(() => !!doc.querySelector('[data-key]'));
  const before = await w.JSBridge.invoke('setting.getAll');
  const originalPane = doc.querySelector<HTMLElement>('.pref-nav-item.active')?.dataset.pane || 'files';
  const search = doc.getElementById('pref-search') as HTMLInputElement;
  const originalSearch = search.value;
  const passed: string[] = [];
  const pane = (id: string) => doc.querySelector<HTMLElement>(`.pref-nav-item[data-pane="${id}"]`)!.click();
  const setLanguage = async (language: 'auto' | Lang) => {
    await w.JSBridge.invoke('setting.put', 'menuLanguage', language);
    const expected = resolveLang(w.navigator.language, language);
    await waitFor(() => doc.documentElement.lang === (expected === 'zh' ? 'zh-CN' : 'en'));
  };
  const visibleCopy = () => Array.from(doc.querySelectorAll<HTMLElement>(
    '.pref-nav-item, .pref-group h4, .pref-name, .pref-note, .pref-hint-line, .pref-btn, .pref-suffix, option',
  )).filter(node => !node.closest('[data-key="theme"]')).map(node => node.textContent || '');
  try {
    search.value = '';
    pane('files');
    const mac = /Mac/i.test(w.navigator.platform), primary = mac ? { metaKey: true } : { ctrlKey: true };
    for (const field of [search, doc.querySelector<HTMLInputElement>('[data-key="launchCustomFolder"]')!]) {
      const original = field.value;
      field.value = 'Language'; field.focus(); field.setSelectionRange(2, 2);
      const composing = new KeyboardEvent('keydown', { key: 'a', ...primary, isComposing: true, bubbles: true, cancelable: true });
      field.dispatchEvent(composing);
      check(!composing.defaultPrevented && field.selectionStart === 2, 'Preferences Select All interrupted an input-method composition');
      if (mac) {
        const lineStart = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
        field.dispatchEvent(lineStart);
        check(!lineStart.defaultPrevented && field.selectionStart === 2, 'Preferences replaced macOS Control-A line navigation');
      }
      const selectAll = new KeyboardEvent('keydown', { key: 'a', ...primary, bubbles: true, cancelable: true });
      field.dispatchEvent(selectAll);
      check(selectAll.defaultPrevented && field.selectionStart === 0 && field.selectionEnd === 8,
        'Preferences Select All did not select the active field');
      field.setRangeText('Applied immediately', field.selectionStart!, field.selectionEnd!, 'end');
      check(field.value === 'Applied immediately', 'Replacing selected preference text appended to the old query');
      field.value = original;
    }
    passed.push('Preferences field Select All replaces the whole query while preserving input-method composition and macOS Control-A');
    for (const lang of ['zh', 'en'] as const) {
      await setLanguage(lang);
      for (const id of ['files', 'editor', 'image', 'markdown', 'export', 'appearance', 'general']) {
        pane(id);
        check(doc.querySelector('.pref-group'), `Missing ${id} pane in ${lang}`);
        for (const text of visibleCopy()) {
          if (lang === 'zh') check(!PREFERENCE_TRANSLATIONS[text] || PREFERENCE_TRANSLATIONS[text] === text,
            `Untranslated Chinese preference: ${text}`);
          else check(!/\p{Script=Han}/u.test(text), `Chinese copy leaked into English preferences: ${text}`);
        }
        for (const control of doc.querySelectorAll<HTMLElement>('[data-key]')) {
          const label = control.getAttribute('aria-label') || '';
          check(!!label && label !== control.dataset.key, `Missing accessible label for ${control.dataset.key}`);
          if (lang === 'zh') check(!PREFERENCE_TRANSLATIONS[label] || PREFERENCE_TRANSLATIONS[label] === label,
            `Untranslated accessible label: ${label}`);
        }
      }
      pane('editor');
      const languageOptions = doc.querySelector<HTMLSelectElement>('[data-key="presetSpellCheck"]')!;
      for (const [code] of SPELL_LANGUAGES) {
        check(languageOptions.querySelector<HTMLOptionElement>(`option[value="${code}"]`)?.textContent === spellLanguageName(code, lang),
          `Dictionary language ${code} did not use the ${lang} display name`);
      }
      check(doc.title === (lang === 'zh' ? '偏好设置' : 'Preferences'), 'Preferences title did not switch language');
      check(search.placeholder === (lang === 'zh' ? '搜索设置…' : 'Search for...'), 'Search placeholder did not switch language');
    }
    passed.push('All seven Preferences panes, controls, options and dictionary language names switch between Chinese and English');

    const realInvoke = w.JSBridge.invoke;
    const failures = new Set(['dictionary.installSelected', 'dictionary.importSelected', 'images.testUploader']);
    const dialogs: { title: string; message: string; buttons: string[]; type: string }[] = [];
    let actionCalls = 0;
    const detail = '/Users/example/LaTeX Markdown --test';
    w.JSBridge.invoke = async (method, ...args) => {
      if (method === 'dialog.showMessageBox') { dialogs.push(args[0] as typeof dialogs[number]); return { response: 0 }; }
      if (failures.has(method)) { actionCalls++; throw new Error(detail); }
      return realInvoke(method, ...args);
    };
    try {
      for (const lang of ['zh', 'en'] as const) {
        await setLanguage(lang);
        for (const [id, label] of [['editor', 'Download selected dictionary'], ['editor', 'Import .aff / .dic'], ['image', 'Test Uploader']]) {
          pane(id);
          const button = Array.from(doc.querySelectorAll<HTMLButtonElement>('.pref-btn')).find(node => node.textContent === (lang === 'zh' ? PREFERENCE_TRANSLATIONS[label] : label))!;
          const previousDialogs = dialogs.length, previousCalls = actionCalls;
          button.click(); button.click();
          check(button.disabled, 'A pending preference action can be submitted twice');
          await waitFor(() => dialogs.length === previousDialogs + 1 && !button.disabled);
          const message = dialogs.at(-1)!;
          check(actionCalls === previousCalls + 1, 'A preference action was submitted more than once');
          check(message.type === 'error' && message.title === (lang === 'zh' ? '偏好设置' : 'Preferences') && message.buttons[0] === (lang === 'zh' ? '确定' : 'OK'),
            'Preference failure dialog did not use the selected interface language');
          check(message.message === (lang === 'zh' ? '操作失败：' : 'Operation failed: ') + detail,
            'Preference failure was hidden or translated a user path or proper name');
        }
      }
    } finally { w.JSBridge.invoke = realInvoke; }
    pane('editor');
    check(Array.from(doc.querySelectorAll('.pref-hint-line')).some(node => node.textContent === (mac ? '(⌘C)' : '(Ctrl+C)')),
      'The copy shortcut hint does not match this platform');
    passed.push('Dictionary and uploader failures show localized application dialogs, preserve error details and reject duplicate submissions');

    pane('files');
    search.value = 'custom folder'; search.dispatchEvent(new Event('input'));
    const draft = doc.querySelector<HTMLInputElement>('[data-key="launchCustomFolder"]')!;
    draft.value = '/Users/example/未保存草稿'; draft.focus(); draft.setSelectionRange(7, 14, 'backward');
    const fieldState = (field: HTMLInputElement) => ({ active: doc.activeElement === field,
      focused: doc.hasFocus(), cssFocus: field.matches(':focus'), start: field.selectionStart,
      end: field.selectionEnd, direction: field.selectionDirection });
    const beforeLanguage = fieldState(draft);
    check(beforeLanguage.active && beforeLanguage.start === 7 && beforeLanguage.end === 14 && beforeLanguage.direction === 'backward',
      'Could not establish the Preferences draft selection: ' + JSON.stringify(beforeLanguage));
    const scroll = doc.querySelector<HTMLElement>('.pref-main')!;
    scroll.scrollTop = 35; const scrollTop = scroll.scrollTop;
    await setLanguage('zh');
    const restored = doc.querySelector<HTMLInputElement>('[data-key="launchCustomFolder"]')!;
    check(restored === draft, 'Language change replaced the native input and discarded its editing state');
    check(restored.value === '/Users/example/未保存草稿', 'Language change discarded an uncommitted text field');
    check(doc.activeElement === restored && restored.selectionStart === 7 && restored.selectionEnd === 14 && restored.selectionDirection === 'backward',
      'Language change lost focus or selection: ' + JSON.stringify({ before: beforeLanguage, after: fieldState(restored) }));
    check(search.value === 'custom folder' && doc.querySelector<HTMLElement>('.pref-nav-item.active')?.dataset.pane === 'files', 'Language change lost search or current pane');
    check(scroll.scrollTop === scrollTop, 'Language change lost pane scroll position');
    check((await w.JSBridge.invoke('setting.getAll')).launchCustomFolder === before.launchCustomFolder, 'Language change saved an uncommitted draft');
    restored.value = String(before.launchCustomFolder ?? '');
    passed.push('Cross-window language changes preserve the active pane, search, unsaved field, focus, selection and scroll');

    search.value = ''; pane('general');
    const languageControl = doc.querySelector<HTMLSelectElement>('[data-key="menuLanguage"]')!;
    languageControl.value = 'en'; languageControl.dispatchEvent(new Event('change'));
    await waitFor(() => doc.documentElement.lang === 'en');
    check(doc.querySelector<HTMLSelectElement>('[data-key="menuLanguage"]')!.value === 'en', 'Language control kept a stale value after switching');
    await setLanguage('auto');
    check(doc.querySelector<HTMLSelectElement>('[data-key="menuLanguage"]')!.value === 'auto', 'External change did not refresh language selection');
    passed.push('The language selector applies immediately and automatic language follows the system locale');
    return passed;
  } finally {
    await setLanguage(before.menuLanguage || 'auto');
    search.value = originalSearch; pane(originalPane);
  }
}
(window as any).runPreferencesLocalizationChecks = () => runPreferencesLocalizationChecks(window);
