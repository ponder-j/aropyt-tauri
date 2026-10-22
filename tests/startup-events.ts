import { DEFAULTS } from '../src/shared/defaults';

type StartupEvent = { type: string; arg?: any };
const startupAssert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
async function startupWait(predicate: () => boolean, message: string): Promise<void> {
  for (let n = 0; n < 300; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

/** Exercise production boot while a theme read is pending, with an isolated native bridge. */
export async function runStartupEventChecks(): Promise<string[]> {
  const parentApi = (window as any).__aropyt;
  startupAssert(parentApi, 'The main application must be ready before startup regression checks');
  const parentBridge = (window as any).JSBridge;
  const originalDocument = parentApi.getEditor().value;
  const originalState = JSON.stringify(parentApi.state);
  const originalSettings = JSON.stringify(await parentBridge.invoke('setting.getAll'));
  const appUrl = new URL('/dist/renderer/index.html', location.href);
  const [html, productionApp] = await Promise.all([
    fetch(appUrl).then(response => { if (!response.ok) throw new Error('Could not read production index.html'); return response.text(); }),
    fetch(new URL('app.js', appUrl)).then(response => { if (!response.ok) throw new Error('Could not read production app.js'); return response.text(); }),
  ]);
  const fixture = new DOMParser().parseFromString(html, 'text/html');
  fixture.querySelectorAll('script').forEach(script => script.remove());
  const base = fixture.createElement('base'); base.href = appUrl.href; fixture.head.prepend(base);
  const frame = document.createElement('iframe'); frame.id = 'startup-event-frame';
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;z-index:1;background:white';
  document.getElementById('main-content')!.append(frame);
  const child = frame.contentWindow as Window & typeof globalThis & { JSBridge: any; __aropyt?: any };
  const doc = frame.contentDocument!;
  const listeners: ((event: StartupEvent) => void)[] = [];
  const errors: string[] = [];
  let themeRequested = false, injected = false;
  let releaseTheme!: () => void;
  const themeGate = new Promise<void>(resolve => { releaseTheme = resolve; });
  const settings = { ...DEFAULTS, menuLanguage: 'en', theme: 'github', autoSave: false,
    onLaunch: 'new', lastFolder: '', sidebarVisible: false, showWordCount: true, showStatusBar: true };
  try {
    doc.open(); doc.write('<!doctype html>' + fixture.documentElement.outerHTML); doc.close();
    await startupWait(() => doc.readyState === 'complete', 'Startup fixture stylesheet load did not finish');
    child.addEventListener('error', event => errors.push(event.message));
    child.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
    if (!child.requestIdleCallback) {
      child.requestIdleCallback = callback => child.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 16 }), 16);
      child.cancelIdleCallback = id => child.clearTimeout(id);
    }
    child.JSBridge = {
      on: (listener: (event: StartupEvent) => void) => { listeners.push(listener); },
      send: () => {},
      pathForFile: (file: File) => parentBridge.pathForFile(file),
      localFileUrl: (...args: unknown[]) => parentBridge.localFileUrl(...args),
      invoke: async (method: string, ...args: unknown[]) => {
        if (method === 'setting.getAll') return { ...settings };
        if (method === 'menu.dump') return { lang: 'en', pref: 'en', locale: 'en-US', lines: [] };
        if (method === 'theme.getCss') {
          themeRequested = true;
          await themeGate;
          return parentBridge.invoke(method, ...args);
        }
        if (method === 'theme.isDark' || method === 'setting.getThemes') return parentBridge.invoke(method, ...args);
        // Window identity, spelling state and preference writes belong only to the fixture.
        if (method === 'spellcheck.state' || method === 'spellcheck.sample') return { mode: 'off', language: 'en-US', enabled: false };
        if (method === 'setting.setCurTheme' || method === 'window.setTitle') return true;
        if (method === 'setting.put') { (settings as Record<string, unknown>)[String(args[0])] = args[1]; return true; }
        throw new Error('Unexpected startup bridge call: ' + method);
      },
    };
    child.eval(productionApp);
    child.dispatchEvent(new child.Event('DOMContentLoaded'));
    await startupWait(() => themeRequested || errors.length > 0, 'Production boot did not reach the deferred theme read');
    startupAssert(!errors.length, errors.join('\n'));
    startupAssert(doc.getElementById('spell-check-popover') && listeners.length > 0 && !child.__aropyt,
      'Startup events were not injected after component subscription and before boot completion');
    startupAssert(!(doc.getElementById('footer-word-count') as HTMLElement).hidden,
      'Startup fixture must initially show word count before its queued preference change');
    const emit = (event: StartupEvent) => { for (const listener of [...listeners]) listener(event); };
    // The previous boot order registered only SpellcheckControl at this point,
    // so both events were discarded. Neither event is emitted again after boot.
    settings.showWordCount = false;
    emit({ type: 'menu', arg: { action: 'toggleSource' } });
    emit({ type: 'setting-changed', arg: { key: 'showWordCount', value: false } });
    injected = true;
    releaseTheme();
    await startupWait(() => !!child.__aropyt || !!doc.querySelector('body > pre'), 'Production boot did not complete after releasing its theme');
    startupAssert(child.__aropyt, 'Startup fixture failed: ' + doc.body.innerText);
    startupAssert(injected && child.__aropyt.state.sourceMode === true,
      'A native menu action received during startup was lost or replayed more than once');
    startupAssert((doc.getElementById('footer-word-count') as HTMLElement).hidden,
      'A preference change received during startup was lost');
    startupAssert(child.__aropyt.getEditor().value === '', 'Startup events changed the fixture document');
    startupAssert(!errors.length, errors.join('\n'));
    startupAssert(parentApi.getEditor().value === originalDocument && JSON.stringify(parentApi.state) === originalState,
      'The isolated startup fixture changed the main document or window state');
    startupAssert(JSON.stringify(await parentBridge.invoke('setting.getAll')) === originalSettings,
      'The isolated startup fixture changed persistent preferences');
    return ['Native menu and preference events received during asynchronous startup are replayed once after the editor is ready'];
  } finally {
    releaseTheme();
    parentApi.getEditor().focus();
    frame.remove();
  }
}
(window as any).runStartupEventChecks = runStartupEventChecks;
