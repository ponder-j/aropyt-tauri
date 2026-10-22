export interface DialogField {
  name: string; label: string; value?: string; type?: 'text' | 'number' | 'select' | 'textarea';
  options?: [string, string][]; min?: number; max?: number;
}

/** Native Chromium dialog provides focus containment, Escape and keyboard
 * submission without moving the document selection used by editing commands. */
export function formDialog(title: string, fields: DialogField[], confirm = '确定'): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog';
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); heading.textContent = title; form.append(heading);
    for (const field of fields) {
      const label = document.createElement('label'); label.textContent = field.label;
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
    }
    const actions = document.createElement('div'); actions.className = 'dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = () => dialog.close('cancel');
    const ok = document.createElement('button'); ok.type = 'submit'; ok.textContent = confirm; ok.value = 'ok'; ok.className = 'primary';
    actions.append(cancel, ok); form.append(actions); dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'ok' ? Object.fromEntries(new FormData(form).entries()) as Record<string, string> : null;
      dialog.remove(); resolve(result);
    }, { once: true });
    dialog.showModal();
    const first = form.querySelector<HTMLInputElement>('input,textarea,select'); first?.focus(); first?.select?.();
  });
}

export function showText(title: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog'); dialog.className = 'aropyt-dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const body = document.createElement('div'); body.className = 'dialog-text'; body.textContent = text;
    const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => dialog.close();
    dialog.append(heading, body, close); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); }, { once: true }); dialog.showModal(); close.focus();
  });
}
