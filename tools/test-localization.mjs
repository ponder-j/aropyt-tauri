import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const flatten = items => items.flatMap(item => [item, ...flatten(item.submenu || [])]);

// This is also used by the real WebView harness. It leaves the user's language
// setting and active document intact and never opens an additional window.
export async function verifyNativeLanguage({ invoke, js, snapshot }) {
  const original = (await invoke('setting.getAll')).menuLanguage;
  const error = async (method, ...args) => {
    try {
      const result = await invoke(method, ...args);
      if (result?.error) return String(result.error);
    } catch (value) { return String(value); }
    assert.fail(method + ' unexpectedly succeeded');
  };
  try {
    for (const lang of ['en', 'zh']) {
      await invoke('setting.put', 'menuLanguage', lang);
      const menu = await js('window.JSBridge.invoke("menu.dump")');
      assert.equal(menu.lang, lang);
      assert(menu.lines.some(line => line.trim() === (lang === 'en' ? 'Interface Language' : '界面语言')));
      assert(menu.lines.some(line => line.includes(lang === 'en' ? 'YAML Front Matter' : 'YAML 元数据')));
      const names = [['document.getDraft', ['bad'], 'Invalid draft', '无效的草稿'],
        ['dictionary.read', ['zz-uninstalled'], 'Spelling dictionary is not installed:', '尚未安装拼写词典：'],
        ['pandoc.export', [{ format: 'not-a-format' }], 'Unsupported export format', '不支持的导出格式'],
        ['images.transfer', ['file:///tmp/reference.png', 'invalid'], 'Invalid image operation', '无效的图片操作'],
        ['getPath', ['literal 中文 Example.md'], 'Unknown data directory: literal 中文 Example.md', '未知数据目录：literal 中文 Example.md']];
      for (const [method, args, en, zh] of names) assert((await error(method, ...args)).includes(lang === 'en' ? en : zh), method);
      if (snapshot) {
        const native = flatten(await snapshot());
        assert(native.some(item => item.label === (lang === 'en' ? 'File' : '文件')), 'Native menu missing '+lang+' File label: '+JSON.stringify(native.map(item=>item.label)));
        if (process.platform === 'darwin') {
          for (const [en, zh] of [['Window', '窗口'], ['About Aropyt', '关于 Aropyt'], ['Services', '服务'], ['Quit Aropyt', '退出 Aropyt']]) {
            assert(native.some(item => item.label === (lang === 'en' ? en : zh)), 'Native role: ' + en);
          }
        }
      }
    }
  } finally {
    await invoke('setting.put', 'menuLanguage', original || 'auto');
    await js('window.JSBridge.invoke("menu.dump")');
  }
}

export async function verifyLocalizationCatalog() {
  const bundled = await build({
    stdin: { contents: `export { L, resolveLang } from './src/main/menu-model'; export { buildMenu } from './src/bridge/menu'; export { serializeMenu, setMenuSettings } from './src/bridge/menu-host'; export { setUiLanguage, uiText } from './src/shared/ui-language';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  for (const platform of ['MacIntel', 'Linux aarch64']) {
    const context = { module: { exports: {} }, navigator: { platform, language: 'en-US' }, window: { JSBridge: { invoke: async () => true } } };
    vm.runInNewContext(bundled.outputFiles[0].text, context);
    const { L, resolveLang, buildMenu, serializeMenu, setMenuSettings, setUiLanguage, uiText } = context.module.exports;
    assert.equal(resolveLang('zh-CN', 'auto'), 'zh');
    assert.equal(resolveLang('en-GB', 'auto'), 'en');
    assert.equal(resolveLang('zh-TW', 'en'), 'en');
    assert.equal(resolveLang('en-US', 'zh'), 'zh');
    for (const [key, [zh, en]] of Object.entries(L)) {
      assert(zh.trim() && en.trim(), 'Empty menu translation: ' + key);
      assert(!/\p{Script=Han}/u.test(en), 'Chinese leaked into English menu: ' + key);
    }
    const make = (lang, generation = lang, changes = {}) => {
      setMenuSettings({ menuLanguage: lang, recentFiles: ['/tmp/English notes.md', '/tmp/中文 文件.md'], recentFolders: ['/tmp/My Folder'], theme: 'github', ...changes });
      const menu = buildMenu({ listThemes: () => changes.themes || ['github', 'night'], currentTheme: () => 'github' });
      return flatten(JSON.parse(JSON.stringify(serializeMenu(menu, generation))));
    };
    const en = make('en'), zh = make('zh');
    assert.equal(en.length, zh.length, 'Switching language removed commands');
    for (let n = 0; n < en.length; n++) {
      for (const property of ['accelerator', 'registerAccelerator', 'role', 'type', 'checked', 'enabled']) {
        if (property === 'checked' && ['Chinese', 'English'].includes(en[n].label)) continue;
        assert.equal(en[n][property], zh[n][property], property + ' changed during translation');
      }
      for (const property of ['event', 'action', 'arg']) assert.deepEqual(en[n][property], zh[n][property], property + ' changed during translation');
      if (en[n].type !== 'separator') assert(en[n].label && zh[n].label, 'A menu relied on an untranslated native role');
      if (en[n].type !== 'separator' && en[n].enabled !== false && !en[n].submenu) {
        assert(en[n].event || en[n].role, 'A menu command depends on a renderer-local callback: ' + en[n].label);
      }
    }
    for (const name of ['English notes.md', '中文 文件.md', 'My Folder']) {
      assert(en.some(item => item.label === name) && zh.some(item => item.label === name), 'User file/folder name was translated');
    }
    // Installing a different recent-file/theme list must carry the new command
    // to any focused window, including one whose own menu snapshot is older.
    const updated = make('en', 'new-window', { recentFiles: ['/tmp/New 中文.md'], recentFolders: ['/tmp/New folder'], themes: ['github', 'night', 'My Theme'] });
    const oldIds = new Set(en.map(item => item.id));
    assert(updated.every(item => !oldIds.has(item.id)), 'Old native IDs can select a different command after replacement');
    const command = item => Object.fromEntries(['event', 'action', 'arg'].filter(key => item[key] !== undefined).map(key => [key, item[key]]));
    assert.deepEqual(command(updated.find(item => item.action === 'toggleSource')), command(en.find(item => item.action === 'toggleSource')));
    assert.deepEqual(command(updated.find(item => item.label === 'New 中文.md')), { event: 'open-file', arg: '/tmp/New 中文.md' });
    assert.deepEqual(command(updated.find(item => item.label === 'New folder')), { event: 'menu', action: 'openFolder', arg: '/tmp/New folder' });
    assert.deepEqual(command(updated.find(item => item.label === 'My Theme')), { event: 'menu', action: 'setTheme', arg: 'My Theme' });
    assert.deepEqual(command(updated.find(item => item.action === 'clearRecent')), { event: 'bridge', action: 'clearRecent' });
    for (const lang of ['auto', 'zh', 'en']) assert(updated.some(item => item.event === 'menu' && item.action === 'setMenuLanguage' && item.arg === lang));
    for (const lang of ['zh', 'en', 'zh']) {
      setUiLanguage(lang);
      assert.equal(uiText('中文按钮', 'English Button'), lang === 'zh' ? '中文按钮' : 'English Button');
    }
  }
  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(config.bundle.resources['../docs/'], 'docs/', 'Localized help was omitted from app resources');
  for (const name of ['user-guide', 'privacy', 'credits', 'migration']) {
    assert((await readFile(`docs/${name}.en.md`, 'utf8')).trim(), 'Missing English help: ' + name);
  }
  console.log('PASS localization: complete menu translations, command/shortcut parity, explicit cross-window menu commands, literal user paths, automatic/explicit language selection, and packaged English help');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyLocalizationCatalog();
