import { getUiLanguage, uiText } from '../shared/ui-language';

export type DialogText = string | (() => string);
export interface DialogField {
  name: string; label: string; value?: string; type?: 'text' | 'number' | 'select' | 'textarea';
  options?: [string, string][]; min?: number; max?: number;
}
const resolveText = (text: DialogText): string => typeof text === 'function' ? text() : text;

/** The native dialog element provides focus containment, Escape and keyboard
 * submission without moving the document selection used by editing commands. */
export function formDialog(title: DialogText, fields: DialogField[] | (() => DialogField[]), confirm: DialogText = () => uiText('确定', 'OK')): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog';
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); form.append(heading);
    const currentFields = () => typeof fields === 'function' ? fields() : fields;
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
      control.value = field.value ?? ''; label.append(control); form.append(label);
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
    const close = document.createElement('button'); close.onclick = () => dialog.close();
    const refreshLanguage = () => {
      dialog.lang = getUiLanguage(); heading.textContent = resolveText(title); body.textContent = resolveText(text);
      close.textContent = uiText('关闭', 'Close');
    };
    refreshLanguage(); window.addEventListener('aropyt-language-changed', refreshLanguage);
    dialog.append(heading, body, close); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      window.removeEventListener('aropyt-language-changed', refreshLanguage); dialog.remove(); resolve();
    }, { once: true }); dialog.showModal(); close.focus();
  });
}
