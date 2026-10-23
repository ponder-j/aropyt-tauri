import { getUiLanguage, uiText } from '../shared/ui-language';

export type DialogText = string | (() => string);
export interface DialogField {
  name: string; label: string; value?: string; type?: 'text' | 'number' | 'select' | 'textarea';
  options?: [string, string][]; min?: number; max?: number;
}
const resolveText = (text: DialogText): string => typeof text === 'function' ? text() : text;
let dialogId = 0;
function labelDialog(dialog: HTMLDialogElement, heading: HTMLElement, body?: HTMLElement): void {
  do { dialog.id = `aropyt-dialog-${++dialogId}`; } while (document.getElementById(dialog.id));
  heading.id = dialog.id + '-title'; dialog.setAttribute('aria-labelledby', heading.id);
  if (body) { body.id = dialog.id + '-body'; dialog.setAttribute('aria-describedby', body.id); }
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  title?: DialogText; message?: DialogText; detail?: DialogText; buttons?: DialogText[];
  defaultId?: number; cancelId?: number; checkboxLabel?: DialogText; checkboxChecked?: boolean;
}
export interface MessageBoxResult { response: number; checkboxChecked: boolean }
let messageQueue: Promise<unknown> = Promise.resolve();

/** Retain the bridge's response indexes while rendering inside the current
 * window. Queue simultaneous notices so keyboard input reaches one at a time. */
export function messageDialog(options: MessageBoxOptions): Promise<MessageBoxResult> {
  const result = messageQueue.then(() => openMessageDialog(options));
  messageQueue = result.catch(() => {});
  return result;
}

function openMessageDialog(options: MessageBoxOptions): Promise<MessageBoxResult> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog aropyt-message-dialog';
    if (options.type === 'error' || options.type === 'warning') dialog.setAttribute('role', 'alertdialog');
    const heading = document.createElement('h2'), body = document.createElement('div'); body.className = 'dialog-text';
    const message = document.createElement('p'), detail = document.createElement('p');
    message.className = 'dialog-message'; detail.className = 'dialog-detail'; body.append(message, detail);
    labelDialog(dialog, heading, body);
    const labels = options.buttons?.length ? options.buttons : [() => uiText('确定', 'OK')];
    const validIndex = (index: number | undefined, fallback: number) => Number.isInteger(index) && index! >= 0 && index! < labels.length ? index! : fallback;
    const defaultId = validIndex(options.defaultId, 0), cancelId = validIndex(options.cancelId, labels.length - 1);
    const actions = document.createElement('div'); actions.className = 'dialog-actions message-actions';
    if (labels.length === 1) actions.classList.add('single-action');
    const buttons = labels.map((_label, index) => {
      const button = document.createElement('button'); button.type = 'button';
      if (index === 0) button.classList.add('primary');
      if (index === cancelId && labels.length > 1) button.classList.add('dialog-cancel');
      button.onclick = () => dialog.close(String(index)); actions.append(button); return button;
    });
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!options.checkboxChecked;
    const checkboxLabel = document.createElement('label'), checkboxText = document.createTextNode('');
    checkboxLabel.className = 'dialog-checkbox'; checkboxLabel.append(checkbox, checkboxText);
    const refreshLanguage = () => {
      dialog.lang = getUiLanguage();
      heading.textContent = resolveText(options.title ?? (() => options.type === 'error' ? uiText('错误', 'Error') : uiText('提示', 'Notice')));
      message.textContent = resolveText(options.message ?? ''); detail.textContent = resolveText(options.detail ?? '');
      message.hidden = !message.textContent; detail.hidden = !detail.textContent;
      labels.forEach((label, index) => { buttons[index].textContent = resolveText(label); });
      checkboxText.data = resolveText(options.checkboxLabel ?? '');
    };
    refreshLanguage(); window.addEventListener('aropyt-language-changed', refreshLanguage);
    dialog.append(heading, body); if (options.checkboxLabel) dialog.append(checkboxLabel); dialog.append(actions); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      window.removeEventListener('aropyt-language-changed', refreshLanguage);
      const response = dialog.returnValue === '' ? cancelId : validIndex(Number(dialog.returnValue), cancelId);
      dialog.remove(); resolve({ response, checkboxChecked: checkbox.checked });
    }, { once: true });
    dialog.showModal(); buttons[defaultId].focus();
  });
}

/** The native dialog element provides focus containment, Escape and keyboard
 * submission without moving the document selection used by editing commands. */
export function formDialog(title: DialogText, fields: DialogField[] | (() => DialogField[]), confirm: DialogText = () => uiText('确定', 'OK')): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog';
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); form.append(heading);
    labelDialog(dialog, heading);
    const currentFields = () => typeof fields === 'function' ? fields() : fields;
    const fieldGroup = document.createElement('div'); fieldGroup.className = 'dialog-fields';
    if (currentFields().length === 2 && currentFields().every(field => field.type === 'number')) fieldGroup.classList.add('dimensions');
    form.append(fieldGroup);
    const bindings = new Map<string, { label: Text; control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }>();
    for (const field of currentFields()) {
      const label = document.createElement('label'), labelText = document.createTextNode(field.label); label.append(labelText);
      const control = document.createElement(field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input');
      control.name = field.name;
      if (control instanceof HTMLInputElement) {
        control.type = field.type === 'number' ? 'number' : 'text';
        if (field.min !== undefined) control.min = String(field.min);
        if (field.max !== undefined) control.max = String(field.max);
      }
      if (control instanceof HTMLSelectElement) for (const [value, text] of field.options ?? []) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; control.append(option);
      }
      control.value = field.value ?? ''; label.append(control); fieldGroup.append(label);
      bindings.set(field.name, { label: labelText, control });
    }
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.onclick = () => dialog.close('cancel');
    const ok = document.createElement('button'); ok.type = 'submit'; ok.value = 'ok'; ok.className = 'primary';
    const refreshLanguage = () => {
      dialog.lang = getUiLanguage(); heading.textContent = resolveText(title);
      cancel.textContent = uiText('取消', 'Cancel'); ok.textContent = resolveText(confirm);
      for (const field of currentFields()) {
        const binding = bindings.get(field.name); if (!binding) continue;
        binding.label.data = field.label;
        if (binding.control instanceof HTMLSelectElement) {
          const labels = new Map(field.options);
          for (const option of binding.control.options) {
            const label = labels.get(option.value); if (label !== undefined) option.textContent = label;
          }
        }
      }
      // Never assign control values or replace controls here: language changes
      // must retain user input, selections and the focused native input node.
    };
    refreshLanguage(); window.addEventListener('aropyt-language-changed', refreshLanguage);
    actions.append(cancel, ok); form.append(actions); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      window.removeEventListener('aropyt-language-changed', refreshLanguage);
      const result = dialog.returnValue === 'ok' ? Object.fromEntries(new FormData(form).entries()) as Record<string, string> : null;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
    const first = form.querySelector<HTMLInputElement>('input,textarea,select'); first?.focus(); first?.select?.();
  });
}

export function showText(title: DialogText, text: DialogText): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog';
    const heading = document.createElement('h2');
    const body = document.createElement('div'); body.className = 'dialog-text';
    labelDialog(dialog, heading, body);
    const close = document.createElement('button'); close.onclick = () => dialog.close();
    const actions = document.createElement('div'); actions.className = 'dialog-actions'; actions.append(close);
    const refreshLanguage = () => {
      dialog.lang = getUiLanguage(); heading.textContent = resolveText(title); body.textContent = resolveText(text);
      close.textContent = uiText('关闭', 'Close');
    };
    refreshLanguage(); window.addEventListener('aropyt-language-changed', refreshLanguage);
    dialog.append(heading, body, actions); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      window.removeEventListener('aropyt-language-changed', refreshLanguage); dialog.remove(); resolve();
    }, { once: true }); dialog.showModal(); close.focus();
  });
}
