import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundled = await build({ stdin: { contents: `export * from './src/shared/shortcuts'; export { buildMenu } from './src/bridge/menu'; export { setMenuSettings } from './src/bridge/menu-host';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs' });
const flatten = items => items.flatMap(item => [item, ...flatten(item.submenu || [])]);
for (const platform of ['MacIntel', 'Win32', 'Linux aarch64']) {
  const context = { module: { exports: {} }, navigator: { platform, language: 'en-US' } };
  vm.runInNewContext(bundled.outputFiles[0].text, context);
  const { buildMenu, setMenuSettings, defaultShortcut, normalizeShortcut, shortcutCombo, shortcutHint, KEY_ACTIONS, TABLE_MOVE_KEYS } = context.module.exports;
  const mac = platform === 'MacIntel';
  setMenuSettings({ menuLanguage: 'en' });
  const menu = flatten(buildMenu({ listThemes: () => [], currentTheme: () => '' }));
  const bindings = new Map();
  const reserve = (key, action) => {
    if (bindings.has(key)) assert.equal(bindings.get(key), action, `${platform}: ${key} bound to both ${bindings.get(key)} and ${action}`);
    bindings.set(key, action);
  };
  for (const entry of menu.filter(item => item.accelerator)) reserve(normalizeShortcut(entry.accelerator), entry.action || entry.role);
  // In a table, the paragraph-after command inserts a row instead.
  const alias = action => ({ image: 'insertImage', pasteAsPlain: 'pasteAndMatchStyle', insertParagraphAfter: 'tableRowAfter' })[action] || action;
  for (const [binding, action] of KEY_ACTIONS) reserve(normalizeShortcut(defaultShortcut(action, binding)), alias(action));
  for (const [key, action] of TABLE_MOVE_KEYS) {
    const command = 'table' + action[0].toUpperCase() + action.slice(1);
    reserve(normalizeShortcut(defaultShortcut(command, 'Alt+' + key)), command);
  }
  assert.equal(shortcutHint(''), '');
  assert.equal(shortcutHint('Ctrl+'), mac ? '⌘' : 'Ctrl+');
  if (mac) {
    // Apple system-wide commands must not be assigned to editor actions.
    for (const key of ['Command+H', 'Command+Alt+H', 'Command+Q', 'Command+Shift+Q', 'Control+Command+Q', 'Command+Tab', 'Command+Shift+Tab', 'Command+`', 'Command+Shift+`', 'Command+Shift+3', 'Command+Shift+4', 'Command+Shift+5', 'Command+Space', 'Control+Space', 'Control+Alt+Space', 'Control+ArrowUp', 'Control+ArrowDown', 'Control+ArrowLeft', 'Control+ArrowRight', 'F3', 'F8', 'F9', 'F11']) {
      assert(!bindings.has(normalizeShortcut(key)), `macOS reserved shortcut: ${key}`);
    }
    for (const [key, action] of [['Control+F', 'find'], ['Control+H', 'replace'], ['Command+P', 'print'], ['Command+Shift+Z', 'redo'], ['Control+Command+F', 'toggleFullScreen'], ['Control+Tab', 'switchTab'], ['Command+G', 'findNext'], ['Command+Shift+G', 'findPrev']]) assert.equal(bindings.get(normalizeShortcut(key)), action);
    for (const key of ['F', 'H', 'B', 'A']) assert.notEqual(shortcutCombo({ key, ctrlKey: true }), shortcutCombo({ key, metaKey: true }));
    assert.equal(shortcutCombo({ key: 'f', ctrlKey: true, metaKey: true }), 'ctrl+cmd+f');
    assert.equal(shortcutHint('Control+H'), '⌃H'); assert.equal(shortcutHint('Ctrl+H'), '⌘H');
    for (const action of ['find', 'replace']) assert.equal(menu.find(item => item.action === action).registerAccelerator, false);
    setMenuSettings({ menuLanguage: 'en', keyBinding: { find: 'Control+Alt+F', replace: 'Command+Alt+R' } });
    const custom = flatten(buildMenu({ listThemes: () => [], currentTheme: () => '' }));
    assert.equal(custom.find(item => item.action === 'find').accelerator, 'Control+Alt+F');
    assert.equal(custom.find(item => item.action === 'replace').accelerator, 'Command+Alt+R');
  } else {
    assert.equal(bindings.get('ctrl+f'), 'find'); assert.equal(bindings.get('ctrl+h'), 'replace');
    assert.equal(bindings.get('ctrl+p'), 'openQuickly'); assert.equal(bindings.get('f8'), 'toggleFocus');
  }
  console.log(`PASS ${platform}: audited ${bindings.size} distinct menu/editor shortcuts, native reservations, hints and custom modifiers`);
}
