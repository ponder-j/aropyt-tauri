/** Use the unshifted punctuation key: Windows reports '+' for Shift+'='. */
export function shortcutCombo(event: KeyboardEvent, mac = /Mac/i.test(navigator.platform)): string {
  if (event.isComposing || event.getModifierState?.('AltGraph') || (!mac && event.metaKey)) return '';
  const punctuation: Record<string, string> = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']',
    Backquote: '`', Backslash: '\\', Slash: '/', Comma: ',', Period: '.' };
  const key = punctuation[event.code] || (/^Digit[0-9]$/.test(event.code) ? event.code.slice(-1) : event.key);
  return [event.ctrlKey || mac && event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+').toLowerCase();
}

export function normalizeShortcut(value: string): string {
  const parts = value.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd|Meta/gi, 'Ctrl').split('+');
  const key = parts.pop() || '+';
  return ['Ctrl', 'Alt', 'Shift'].filter(mod => parts.some(p => p.toLowerCase() === mod.toLowerCase()))
    .concat(key).join('+').toLowerCase();
}

export function shortcutHint(value: string, mac = /Mac/i.test(navigator.platform)): string {
  const normal = value.replace(/CommandOrControl|CmdOrCtrl|Command|Cmd|Meta/gi, 'Ctrl');
  return mac ? normal.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : normal;
}
