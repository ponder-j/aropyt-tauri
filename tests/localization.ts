const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for interface language');
}

(window as any).runLocalizationChecks = async () => {
  const api = (window as any).__aropyt, editor = api.getEditor(), bridge = (window as any).JSBridge;
  const original = (await bridge.invoke('setting.getAll')).menuLanguage;
  const passed: string[] = [];
  const source = '# English 与中文\n\n- [ ] Keep literal text\n\n```javascript\nconst value = 1;\n```\n\n> [!NOTE]\n> Literal Note 内容\n\n| Name | 内容 |\n| --- | --- |\n| Keep | unchanged |';
  editor.setValue(source);
  editor.view.dispatch({ selection: { anchor: 2, head: 9 } });
  const selection = editor.view.state.selection.main.toJSON();
  try {
    for (const lang of ['zh', 'en', 'zh'] as const) {
      await bridge.invoke('setting.put', 'menuLanguage', lang);
      await waitFor(() => document.documentElement.lang === (lang === 'zh' ? 'zh-CN' : 'en') &&
        document.querySelector<HTMLInputElement>('.cm-code-language')?.placeholder === (lang === 'zh' ? '代码语言' : 'Code language'));
      const text = (zh: string, en: string) => lang === 'zh' ? zh : en;
      assert(document.querySelector('#sidepanel-segmented-input-files')?.textContent === text('文件', 'Files'), 'Sidebar tabs did not switch');
      assert(document.querySelector('#sidebar-tabs')?.getAttribute('aria-label') === text('侧边栏', 'Sidebar'), 'Sidebar accessibility label did not switch');
      assert(document.querySelector<HTMLInputElement>('#quick-open-input')?.placeholder === text('按文件名搜索', 'Search by file name'), 'Quick open did not switch');
      assert(document.querySelector('#outline-content')?.getAttribute('data-after-content') === text('大纲为空', 'Outline is Empty.'), 'Empty state did not switch');
      assert(document.querySelector('.cm-list-marker input')?.getAttribute('aria-label') === text('任务状态', 'Task status'), 'Existing task checkbox did not switch');
      assert(document.querySelector<HTMLInputElement>('.cm-code-language')?.value === 'javascript', 'Language switch translated a code language name');
      assert(editor.value === source, 'Language switch changed document content');
      assert(JSON.stringify(editor.view.state.selection.main.toJSON()) === JSON.stringify(selection), 'Language switch moved the selection');

      const opened = api.runAction('insertTable');
      await waitFor(() => !!document.querySelector('dialog[open]'));
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
      assert(dialog.querySelector('h2')?.textContent === text('插入表格', 'Insert Table'), 'Table dialog title did not switch');
      assert(dialog.querySelector('label')?.textContent === text('列数', 'Columns'), 'Table field did not switch');
      assert(dialog.querySelector('button[type=submit]')?.textContent === text('确定', 'OK'), 'Dialog confirmation did not switch');
      const cancel = dialog.querySelector<HTMLButtonElement>('button[type=button]')!;
      assert(cancel.textContent === text('取消', 'Cancel'), 'Dialog cancel did not switch'); cancel.click(); await opened;
      assert(editor.value === source, 'Cancelling a localized dialog edited the document');
    }
    passed.push('Main UI, empty states, existing editor controls and dialogs switch languages without translating document text or changing selection');
    const openDialog = api.runAction('insertTable');
    await waitFor(() => !!document.querySelector('dialog[open]'));
    const open = document.querySelector<HTMLDialogElement>('dialog[open]')!;
    const columns = open.querySelector<HTMLInputElement>('[name=columns]')!;
    columns.value = '7'; columns.focus();
    await bridge.invoke('setting.put', 'menuLanguage', 'en');
    await waitFor(() => open.querySelector('h2')?.textContent === 'Insert Table');
    assert(columns.value === '7' && document.activeElement === columns, 'Translating an open dialog discarded its input or focus');
    assert(open.querySelector('label')?.firstChild?.textContent === 'Columns', 'Open dialog fields kept the old language');
    open.querySelector<HTMLButtonElement>('button[type=button]')!.click(); await openDialog;
    passed.push('An already open dialog translates in place while preserving unfinished input and focus');
    await api.runAction('strong'); const formatted = editor.value;
    await bridge.invoke('setting.put', 'menuLanguage', 'en');
    await waitFor(() => document.documentElement.lang === 'en');
    await api.runAction('undo'); assert(editor.value === source, 'Language switching inserted an undo step');
    await api.runAction('redo'); assert(editor.value === formatted, 'Language switching broke redo history');
    passed.push('Changing interface language preserves document undo and redo history');
    return passed;
  } finally {
    await bridge.invoke('setting.put', 'menuLanguage', original || 'auto');
  }
};
