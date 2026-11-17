const isMac = (): boolean => /Mac/i.test(navigator.platform);

export const TABLE_MOVE_KEYS = [
  ['ArrowUp', 'rowUp'], ['ArrowDown', 'rowDown'], ['ArrowLeft', 'columnLeft'], ['ArrowRight', 'columnRight'],
] as const;

// Ctrl in existing settings means the platform's primary modifier. Control is
// always the physical Control key, including on macOS.
const MAC_SHORTCUTS: Record<string, string> = {
  find: 'Control+F', replace: 'Control+H',
  findNext: 'Command+G', findPrev: 'Command+Shift+G',
  openQuickly: 'Control+Shift+O', print: 'Command+P',
  redo: 'Command+Shift+Z', pasteAsPlain: 'Command+Alt+Shift+V',
  inlineCode: 'Control+Shift+`', insertQuote: 'Control+Shift+Q',
  toggleOutline: 'Control+Shift+1', showFileList: 'Control+Shift+2', showFileTree: 'Control+Shift+3',
  toggleFocus: 'Control+Shift+8', toggleTypewriter: 'Control+Shift+9',
  toggleFullScreen: 'Control+Command+F', switchTab: 'Control+Tab',
  toggleDevTools: 'Command+Alt+I',
  strike: 'Control+Shift+5',
  tableRowUp: 'Control+Command+ArrowUp', tableRowDown: 'Control+Command+ArrowDown',
  tableColumnLeft: 'Control+Command+ArrowLeft', tableColumnRight: 'Control+Command+ArrowRight',
};

export function defaultShortcut(action: string, fallback: string, mac = isMac()): string {
  return mac ? MAC_SHORTCUTS[action] ?? fallback : fallback;
}

export function primaryModifier(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>, mac = isMac()): boolean {
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Use the unshifted punctuation key: Windows reports '+' for Shift+'='. */
export function shortcutCombo(event: KeyboardEvent, mac = isMac()): string {
  if (event.isComposing || event.getModifierState?.('AltGraph') || (!mac && event.metaKey)) return '';
  const punctuation: Record<string, string> = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']',
    Backquote: '`', Backslash: '\\', Slash: '/', Comma: ',', Period: '.' };
  const key = punctuation[event.code] || (/^Digit[0-9]$/.test(event.code) ? event.code.slice(-1) : event.key);
  return [event.ctrlKey ? 'Ctrl' : '', mac && event.metaKey ? 'Cmd' : '', event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+').toLowerCase();
}

export function normalizeShortcut(value: string, mac = isMac()): string {
  const parts = value.split('+');
  const key = parts.pop() || '+';
  const modifiers = parts.map(part => {
    switch (part.trim().toLowerCase()) {
      case 'control': return 'ctrl';
      case 'ctrl': case 'commandorcontrol': case 'cmdorctrl': return mac ? 'cmd' : 'ctrl';
      case 'command': case 'cmd': case 'meta': case 'super': return mac ? 'cmd' : 'ctrl';
      case 'option': return 'alt';
      default: return part.trim().toLowerCase();
    }
  });
  return ['ctrl', 'cmd', 'alt', 'shift'].filter(mod => modifiers.includes(mod)).concat(key.toLowerCase()).join('+');
}

export function shortcutAccelerator(value: string, mac = isMac()): string {
  if (!value) return '';
  const parts = normalizeShortcut(value, mac).split('+');
  const key = value.split('+').pop() || (value.endsWith('+') ? '+' : '');
  parts.pop();
  return parts.map(mod => ({ ctrl: mac ? 'Control' : 'Ctrl', cmd: 'Command', alt: 'Alt', shift: 'Shift' })[mod])
    .concat(key).join('+');
}

export function shortcutHint(value: string, mac = isMac()): string {
  // Context menus also use a modifier-only prefix before the word "Click".
  const prefix = value.endsWith('+') && !value.endsWith('++');
  const accel = prefix ? shortcutAccelerator(value + '_key', mac).replace(/_key$/, '') : shortcutAccelerator(value, mac);
  return mac ? accel.replace(/Control\+/g, '⌃').replace(/Command\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧')
    .replace(/ArrowUp/g, '↑').replace(/ArrowDown/g, '↓').replace(/ArrowLeft/g, '←').replace(/ArrowRight/g, '→') : accel;
}

export const KEY_ACTIONS: [string, string][] = [
  ['Ctrl+1', 'heading:1'], ['Ctrl+2', 'heading:2'], ['Ctrl+3', 'heading:3'],
  ['Ctrl+4', 'heading:4'], ['Ctrl+5', 'heading:5'], ['Ctrl+6', 'heading:6'], ['Ctrl+0', 'heading:0'],
  ['Ctrl+b', 'strong'], ['Ctrl+i', 'emphasis'], ['Ctrl+u', 'underline'],
  ['Ctrl+Shift+`', 'inlineCode'], ['Ctrl+Shift+h', 'highlight'], ['Ctrl+k', 'link'],
  ['Ctrl+Shift+i', 'image'], ['Ctrl+\\', 'clearFormat'],
  ['Ctrl+/', 'toggleSource'], ['Ctrl+Shift+l', 'toggleSidebar'],
  ['Ctrl+f', 'find'], ['Ctrl+h', 'replace'], ['F3', 'findNext'], ['Shift+F3', 'findPrev'],
  ['Ctrl+s', 'save'], ['Ctrl+Shift+s', 'saveAs'], ['Ctrl+n', 'new'], ['Ctrl+o', 'open'],
  ['Ctrl+p', 'openQuickly'], ['Ctrl+Shift+k', 'insertFences'], ['Ctrl+Shift+m', 'insertMathBlock'],
  ['Ctrl+Shift+q', 'insertQuote'], ['Ctrl+Shift+x', 'insertTaskList'], ['Ctrl+]', 'indent'], ['Ctrl+[', 'outdent'],
  ['Ctrl+Enter', 'insertParagraphAfter'], ['Ctrl+Shift+Enter', 'insertParagraphBefore'],
  ['Ctrl+Shift+d', 'deleteBlock'], ['F8', 'toggleFocus'], ['F9', 'toggleTypewriter'],
  ['Ctrl+Alt+Shift+l', 'deleteLine'],
  ['Ctrl+Shift+c', 'copyAsMarkdown'], ['Ctrl+Shift+v', 'pasteAsPlain'],
  ['Ctrl+=', 'headingUp'], ['Ctrl+-', 'headingDown'],
  ['Ctrl+Shift+[', 'insertOrderedList'], ['Ctrl+Shift+]', 'insertUnorderedList'],
  ['Alt+Shift+5', 'strike'], ['Ctrl+Shift+t', 'insertTable'],
];
