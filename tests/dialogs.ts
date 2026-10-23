import { formDialog, messageDialog, showText } from '../src/renderer/dialogs';
import { getUiLanguage, setUiLanguage, uiText } from '../src/shared/ui-language';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function opened(): Promise<HTMLDialogElement> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) return dialog;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('The application dialog did not open');
}
const button = (dialog: HTMLDialogElement, index: number) => dialog.querySelectorAll<HTMLButtonElement>('button')[index];

(window as any).runDialogChecks = async () => {
  const passed: string[] = [], invoke = window.JSBridge.invoke;
  const before = document.activeElement as HTMLElement | null;
  const focusTarget = document.createElement('button'); focusTarget.textContent = 'Dialog focus test';
  document.body.append(focusTarget); focusTarget.focus();
  try {
    const confirm = invoke('dialog.showMessageBox', {
      title: '保存', message: '是否保存更改？', detail: '如果不保存，您的更改将会丢失。',
      buttons: ['保存', '丢弃', '取消'], defaultId: 0, cancelId: 2, type: 'warning',
    });
    const save = await opened();
    assert(save.classList.contains('aropyt-message-dialog'), 'A bridge confirmation did not use the application message dialog');
    assert(save.querySelector('h2')?.textContent === '保存' && save.querySelector('.dialog-detail')?.textContent === '如果不保存，您的更改将会丢失。', 'Save title or explanation was lost');
    assert(save.getAttribute('aria-labelledby') === save.querySelector('h2')?.id && save.getAttribute('role') === 'alertdialog', 'Warning dialog is not accessibly labelled');
    assert(document.activeElement === button(save, 0), 'The default confirmation button was not focused');
    const actions = button(save, 0).getBoundingClientRect(), cancel = button(save, 2).getBoundingClientRect();
    assert(cancel.left - actions.right > 100 && getComputedStyle(save).borderRadius === '0px', 'Save actions did not match the grouped Typora layout');
    button(save, 1).click(); assert((await confirm).response === 1, 'Discard returned the wrong response index');
    assert(document.activeElement === focusTarget, 'Closing a message dialog did not restore the original focus');
    passed.push('Bridge confirmations use the application UI, accessible labels, Typora action layout and original response indexes');

    const cancellation = invoke('dialog.showMessageBox', { message: 'Cancel this action', buttons: ['Proceed', 'Cancel'], defaultId: 1, cancelId: 1 });
    const cancelled = await opened(); assert(document.activeElement === button(cancelled, 1), 'The requested default cancel button was ignored');
    cancelled.close(); assert((await cancellation).response === 1, 'Closing the dialog executed the primary action');
    passed.push('Dismissal resolves to cancelId and destructive prompts can default to Cancel');

    const api = (window as any).__aropyt, dirty = api.state.dirty, file = api.state.file;
    const source = api.getEditor().value, selection = JSON.stringify(api.getEditor().view.state.selection.main.toJSON());
    try {
      api.state.dirty = true;
      const firstClose = api.confirmSave(), repeatedClose = api.confirmSave();
      assert(firstClose === repeatedClose, 'Repeated close requests created separate save confirmations');
      const save = await opened();
      button(save, 0).dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: /Mac/.test(navigator.platform), bubbles: true, cancelable: true }));
      save.close();
      assert(await firstClose === false && await repeatedClose === false, 'Cancelling a save allowed a close request');
      assert(api.getEditor().value === source && JSON.stringify(api.getEditor().view.state.selection.main.toJSON()) === selection, 'A modal shortcut changed the underlying document or selection');
      api.state.file = null;
      const realInvoke = window.JSBridge.invoke;
      let saves = 0;
      window.JSBridge.invoke = async (method, ...args) => {
        if (method === 'export.saveFile') { saves++; return null; }
        return realInvoke(method, ...args);
      };
      try {
        const save = api.confirmSave(); button(await opened(), 0).click();
        assert(await save === false && saves === 1 && api.state.dirty, 'Cancelling Save As closed the document or marked it saved');
      } finally { window.JSBridge.invoke = realInvoke; }
    } finally { api.state.dirty = dirty; api.state.file = file; }
    passed.push('Actual save confirmations deduplicate close requests, isolate editor shortcuts and preserve edits when Save As is cancelled');

    const first = invoke('dialog.showMessageBox', { message: 'First queued notice' });
    const second = invoke('dialog.showMessageBox', { message: 'Second queued notice' });
    const firstDialog = await opened();
    assert(document.querySelectorAll('dialog[open]').length === 1 && firstDialog.textContent?.includes('First queued notice'), 'Concurrent notices stole focus from each other');
    button(firstDialog, 0).click(); await first;
    const secondDialog = await opened(); assert(secondDialog.textContent?.includes('Second queued notice'), 'A queued notice was lost');
    button(secondDialog, 0).click(); await second;
    passed.push('Concurrent message requests are presented one at a time without losing either result');

    const error = messageDialog({ type: 'error', title: '<img src=x onerror=alert(1)>', message: 'Literal <b>message</b>',
      detail: '/Users/example/中文 & LaTeX --test\n' + 'Long diagnostic detail. '.repeat(800), checkboxLabel: 'Remember this choice', checkboxChecked: true });
    const errorDialog = await opened();
    assert(!errorDialog.querySelector('img,b') && errorDialog.querySelector('h2')?.textContent === '<img src=x onerror=alert(1)>', 'Message text was interpreted as HTML');
    const diagnosticBody = errorDialog.querySelector<HTMLElement>('.dialog-text')!;
    assert(diagnosticBody.scrollHeight > diagnosticBody.clientHeight && errorDialog.getBoundingClientRect().bottom <= innerHeight, 'Long diagnostics escaped the viewport');
    errorDialog.querySelector<HTMLInputElement>('input')!.checked = false;
    button(errorDialog, 0).click(); assert((await error).checkboxChecked === false, 'Checkbox state was lost');
    passed.push('Error dialogs preserve literal paths, escape HTML and keep long details inside the viewport');

    const language = getUiLanguage();
    try {
      setUiLanguage('zh');
      const form = formDialog(() => uiText('插入表格', 'Insert Table'), () => [
        { name: 'columns', label: uiText('列数', 'Columns'), value: '3', type: 'number' },
        { name: 'rows', label: uiText('行数', 'Rows'), value: '4', type: 'number' },
      ]);
      const table = await opened(), columns = table.querySelector<HTMLInputElement>('[name=columns]')!;
      assert(table.querySelector('.dialog-fields.dimensions'), 'Table dimensions did not use the compact horizontal form');
      assert(table.querySelector('label')!.getBoundingClientRect().height <= columns.getBoundingClientRect().height + 1, 'Chinese dimension labels wrapped vertically');
      columns.value = '7'; columns.focus(); setUiLanguage('en'); window.dispatchEvent(new Event('aropyt-language-changed'));
      assert(table.querySelector('h2')?.textContent === 'Insert Table' && columns.value === '7' && document.activeElement === columns, 'Translating a form discarded its unfinished input or focus');
      button(table, 1).click(); assert((await form)?.columns === '7', 'Form confirmation lost its field values');
      const info = showText('Document Properties', 'Literal document information');
      const infoDialog = await opened(); assert(infoDialog.getAttribute('aria-describedby') === infoDialog.querySelector('.dialog-text')?.id, 'Information dialog is not accessibly described');
      button(infoDialog, 0).click(); await info;
    } finally { setUiLanguage(language); window.dispatchEvent(new Event('aropyt-language-changed')); }
    passed.push('Input and information dialogs share the same style and preserve input while switching language');

    for (const [method, args] of [['window.about', []], ['help.open', ['license']]] as const) {
      const info = invoke(method, ...args); const dialog = await opened();
      assert(dialog.classList.contains('aropyt-message-dialog') && dialog.textContent?.includes('Aropyt'), 'A native information command bypassed the application dialog');
      button(dialog, 0).click(); await info;
    }
    passed.push('Native About and License commands also render application dialogs');
    return passed;
  } finally {
    document.querySelectorAll<HTMLDialogElement>('.aropyt-dialog[open]').forEach(dialog => dialog.close());
    focusTarget.remove(); if (before?.isConnected) before.focus();
  }
};
