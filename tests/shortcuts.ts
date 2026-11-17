// Exercise the installed application handler, including editable table cells.
(window as any).runShortcutChecks = async () => {
  if (!/Mac/i.test(navigator.platform)) return [];
  const api = (window as any).__aropyt, editor = api.getEditor();
  const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const send = (target: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    target.dispatchEvent(event); return event;
  };
  const content = () => editor.view.contentDOM as HTMLElement;
  const close = () => send(document.activeElement as HTMLElement, 'Escape');
  editor.setValue('alpha beta alpha'); editor.focus();
  editor.view.dispatch({ selection: { anchor: 6 } });
  send(content(), 'a', { ctrlKey: true });
  assert(editor.view.state.selection.main.empty && editor.view.state.selection.main.head === 0, 'Control-A selected the document instead of moving to line start');
  editor.view.dispatch({ selection: { anchor: 6 } });
  send(content(), 'b', { ctrlKey: true });
  assert(editor.value === 'alpha beta alpha' && editor.view.state.selection.main.head === 5, 'Control-B formatted text instead of moving left');
  for (const [key, replace] of [['f', false], ['h', true]] as const) {
    editor.focus(); const event = send(content(), key, { ctrlKey: true });
    await tick();
    assert(event.defaultPrevented && document.body.classList.contains('search-open'), 'Control-' + key + ' did not open search');
    assert(document.body.classList.contains('search-replace-open') === replace && editor.value === 'alpha beta alpha', 'Find/replace mode or document changed incorrectly');
  }
  send(document.activeElement as HTMLElement, 'f', { ctrlKey: true });
  await tick();
  assert(!document.body.classList.contains('search-replace-open'), 'Control-F could not switch from the replace query');
  send(document.activeElement as HTMLElement, 'h', { ctrlKey: true });
  await tick();
  assert(document.body.classList.contains('search-replace-open'), 'Control-H could not switch from the find query');
  const query = document.getElementById('search-panel-input') as HTMLInputElement;
  query.value = 'alpha'; query.dispatchEvent(new Event('input'));
  const first = editor.view.state.selection.main.from;
  send(query, 'g', { metaKey: true });
  await tick();
  assert(editor.view.state.selection.main.from !== first, 'Command-G could not find the next match from the query field');
  send(query, 'G', { metaKey: true, shiftKey: true });
  await tick();
  assert(editor.view.state.selection.main.from === first, 'Command-Shift-G could not return to the previous match');
  close();
  for (const [key, modifiers] of [
    ['h', { metaKey: true }], ['Q', { metaKey: true, shiftKey: true }],
    ['`', { metaKey: true, shiftKey: true, code: 'Backquote' }], ['Tab', { metaKey: true }],
    ['#', { metaKey: true, shiftKey: true, code: 'Digit3' }], ['F3', {}], ['F8', {}], ['F9', {}], ['F11', {}],
  ] as [string, KeyboardEventInit][]) {
    assert(!send(document.body, key, modifiers).defaultPrevented, 'Renderer captured macOS shortcut ' + key);
    assert(editor.value === 'alpha beta alpha' && !document.body.classList.contains('search-open'), 'Reserved key ran an editor action');
  }
  editor.focus(); editor.view.dispatch({ selection: { anchor: 0 } });
  send(content(), 'Q', { ctrlKey: true, shiftKey: true });
  await tick();
  assert(editor.value === '> alpha beta alpha', 'Control-Shift-Q failed to insert a quote');
  editor.setValue('| Name | Value |\n| --- | --- |\n| A | B |');
  const cell = document.querySelector<HTMLElement>('.md-table-widget th')!; cell.focus();
  send(cell, 'a', { ctrlKey: true });
  assert(window.getSelection()?.toString() !== 'Name', 'Table replaced Control-A with Select All');
  send(cell, 'a', { metaKey: true });
  assert(window.getSelection()?.toString() === 'Name', 'Table Command-A failed to select its own cell');
  send(cell, 'h', { ctrlKey: true });
  await tick();
  assert(document.body.classList.contains('search-replace-open') && editor.value.includes('Name'), 'Control-H failed in a table or deleted cell text');
  close();
  const movingCell = document.querySelector<HTMLElement>('.md-table-widget th')!; movingCell.focus();
  const table = editor.value;
  send(movingCell, 'ArrowRight', { altKey: true });
  assert(editor.value === table, 'Option-Arrow moved a table column instead of the text caret');
  send(movingCell, 'ArrowRight', { ctrlKey: true, metaKey: true });
  assert(editor.value.indexOf('Value') < editor.value.indexOf('Name'), 'Control-Command-Arrow failed to move the table column');
  editor.setValue('Shortcut checks complete'); editor.focus();
  return ['macOS physical Control find/replace works in text, tables and query fields; Command system shortcuts pass through', 'macOS Control-A/B retain text movement, Command-A selects table cells, and the new quote shortcut works', 'macOS table movement uses Control-Command-Arrow and preserves Option-Arrow text navigation'];
};
