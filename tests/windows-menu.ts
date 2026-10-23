export async function runWindowsMenuChecks(): Promise<string[]> {
  const bridge = window.JSBridge, api = (window as any).__aropyt, editor = api.getEditor();
  const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const frame = () => new Promise(resolve => setTimeout(resolve, 80));
  const key = (key: string, code = '', options: KeyboardEventInit = {}) =>
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...options }));
  const before = await bridge.invoke('setting.getAll'), oldDoc = editor.value;
  try {
    await bridge.invoke('setting.put', 'menuLanguage', 'zh'); await bridge.invoke('menu.dump'); await frame();
    const bar = document.getElementById('aropyt-menubar')!;
    check(bar?.getAttribute('role') === 'menubar' && bar.children.length === 7, 'Windows menu bar missing');
    check(bar.getBoundingClientRect().height >= 25, 'Menu bar is too cramped');
    check(bar.children[0].textContent === '文件(F)' && bar.children[1].textContent === '编辑(E)', 'Windows access keys missing');
    editor.focus(); key('f', 'KeyF', { altKey: true });
    let panel = document.querySelector<HTMLElement>('.aropyt-app-menu')!;
    check(panel && panel.getBoundingClientRect().width >= 240, 'Typora-sized dropdown missing');
    check(panel.querySelector('button')!.getBoundingClientRect().height >= 28, 'Dropdown rows are too cramped');
    check(panel.contains(document.activeElement), 'Alt+F did not focus the menu');
    key('ArrowDown'); check(panel.querySelectorAll('button')[1] === document.activeElement, 'Menu arrow navigation failed');
    key('Escape'); check(!document.querySelector('.aropyt-app-menu') && editor.view.hasFocus, 'Escape did not restore editor focus');
    (bar.children[1] as HTMLButtonElement).click(); panel = document.querySelector('.aropyt-app-menu')!;
    check(!/[⌘⌥⇧⌃]/.test(panel.textContent || ''), 'macOS symbols remain in Windows menus');
    check(panel.textContent?.includes('Ctrl+Shift+C'), 'Windows shortcut column missing'); key('Escape');
    const zoom = document.body.style.zoom;
    try {
      for (const scale of [0.75, 1.25, 1.5]) {
        document.body.style.zoom = String(scale); await frame();
        check(Math.abs(bar.getBoundingClientRect().height - 26) < 1, 'Document zoom changed menu bar height');
        (bar.children[0] as HTMLButtonElement).click();
        const rect = document.querySelector('.aropyt-app-menu')!.getBoundingClientRect();
        check(rect.width >= 240 && rect.width < 241 && rect.top >= 25 && rect.bottom <= innerHeight, 'Zoomed menu moved offscreen or changed size');
        key('Escape');
      }
    } finally { document.body.style.zoom = zoom; await frame(); }
    editor.setValue('word'); editor.view.dispatch({ selection: { anchor: 0, head: 4 } }); editor.focus();
    key('~', 'Backquote', { ctrlKey: true, shiftKey: true }); await frame();
    check(editor.value === '`word`', 'Ctrl+Shift+Backquote failed with the Windows shifted key value');
    editor.setValue('item'); editor.focus(); key('{', 'BracketLeft', { ctrlKey: true, shiftKey: true }); await frame();
    check(/^1\. item/.test(editor.value), 'Ctrl+Shift+[ did not insert an ordered list');
    editor.setValue('item'); editor.focus(); key('}', 'BracketRight', { ctrlKey: true, shiftKey: true }); await frame();
    check(/^[-*+] item/.test(editor.value), 'Ctrl+Shift+] did not insert an unordered list');
    await bridge.invoke('setting.put', 'keyBinding', { ...before.keyBinding, strong: 'Ctrl+Alt+B' }); await bridge.invoke('menu.dump'); await frame();
    (bar.children[3] as HTMLButtonElement).click();
    check(document.querySelector('.aropyt-app-menu')?.textContent?.includes('Ctrl+Alt+B'), 'Custom shortcut not shown in menu'); key('Escape');
    editor.setValue('word'); editor.view.dispatch({ selection: { anchor: 0, head: 4 } }); editor.focus();
    key('b', 'KeyB', { ctrlKey: true, altKey: true }); await frame(); check(editor.value === '**word**', 'Custom shortcut did not run');
    return ['Windows menu matches Typora dimensions, access keys, arrow navigation and focus restoration',
      'Windows shortcuts show Ctrl/Alt/Shift and correctly handle shifted punctuation and custom bindings'];
  } finally {
    await bridge.invoke('setting.put', 'keyBinding', before.keyBinding || {});
    await bridge.invoke('setting.put', 'menuLanguage', before.menuLanguage || 'auto');
    editor.setValue(oldDoc); editor.focus();
  }
}
(window as any).runWindowsMenuChecks = runWindowsMenuChecks;
