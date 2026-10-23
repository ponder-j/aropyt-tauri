export type FileSort = 'natural' | 'name' | 'modified';

interface SidebarOptions {
  lang(): 'zh' | 'en';
  root(): string | null;
  run(action: string, arg?: unknown): Promise<unknown>;
  refresh(): Promise<void>;
  create(path: string): Promise<boolean>;
  sort(): { by: FileSort; descending: boolean };
  setSort(by: FileSort, descending: boolean): Promise<void>;
  notify(message: string): void;
}

/** Folder actions stay inside the sidebar, including keyboard access to its fading toolbar. */
export class SidebarControls {
  private readonly sidebar = document.getElementById('aropyt-sidebar')!;
  private readonly menu = document.createElement('div');
  private anchor?: HTMLButtonElement;
  private composer?: HTMLElement;
  private menuRevision = 0;
  private root: string | null = null;
  constructor(private options: SidebarOptions) {
    this.menu.id = 'sidebar-actions-menu'; this.menu.hidden = true; this.menu.setAttribute('role', 'menu');
    document.body.append(this.menu);
    document.getElementById('sidebar-new-file-btn')!.addEventListener('click', () => void this.newFile().catch(error => this.options.notify(String(error))));
    for (const id of ['sidebar-folder-btn', 'sidebar-menu-btn']) {
      const button = document.getElementById(id) as HTMLButtonElement;
      button.addEventListener('click', () => void this.toggleMenu(button));
    }
    document.addEventListener('mousedown', event => {
      if (!this.menu.contains(event.target as Node) && !this.anchor?.contains(event.target as Node)) this.dismiss();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.menu.hidden) { event.preventDefault(); event.stopPropagation(); this.dismiss(true); }
    }, true);
    this.menu.addEventListener('keydown', event => {
      const items = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      let index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[index]?.focus();
      } else if (event.key === 'Tab') this.dismiss();
    });
    window.addEventListener('blur', () => this.dismiss());
    window.addEventListener('resize', () => this.positionMenu());
    window.addEventListener('aropyt-language-changed', () => {
      this.dismiss();
      this.composer?.querySelector('input')?.setAttribute('aria-label', this.text('文件名', 'File name'));
    });
  }
  private text(zh: string, en: string): string { return this.options.lang() === 'zh' ? zh : en; }
  update(panel: string, list: boolean): void {
    const root = this.options.root();
    if (this.root !== root) { this.composer?.remove(); this.composer = undefined; }
    if (this.sidebar.dataset.panel !== panel || this.root !== root) this.dismiss();
    this.sidebar.dataset.panel = panel; this.root = root;
    const folder = document.getElementById('sidebar-folder-btn')!;
    document.getElementById('sidebar-footer-main-item-label')!.textContent = root?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || this.text('打开文件夹…', 'Open Folder…');
    folder.title = root || this.text('打开文件夹…', 'Open Folder…');
    for (const [id, zh, en] of [
      ['ty-sidebar-footer', '文件操作', 'File actions'], ['sidebar-new-file-btn', '新建文件', 'New File'],
      ['sidebar-menu-btn', '更多操作', 'More Actions'], ['switch-file-list-btn', '切换列表 / 树视图', 'Toggle List / Tree View'],
    ]) {
      const el = document.getElementById(id)!; el.setAttribute('aria-label', this.text(zh, en));
      if (id !== 'ty-sidebar-footer') el.title = this.text(zh, en);
    }
    document.querySelector('#switch-file-list-btn span')!.className = 'ty-icon ' + (list ? 'ty-file-tree' : 'ty-list');
  }
  dismiss(restore = false): void {
    ++this.menuRevision;
    this.menu.hidden = true; this.sidebar.classList.remove('sidebar-menu-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
    if (restore) this.anchor?.focus({ preventScroll: true });
    this.anchor = undefined;
  }
  private item(label: string, action: () => unknown, disabled = false): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.setAttribute('role', 'menuitem'); button.disabled = disabled;
    button.addEventListener('click', () => {
      this.dismiss(true);
      void Promise.resolve().then(action).catch(error => this.options.notify(String(error)));
    });
    this.menu.append(button); return button;
  }
  private heading(text: string): void { const label = document.createElement('div'); label.className = 'sidebar-menu-heading'; label.textContent = text; this.menu.append(label); }
  private async toggleMenu(anchor: HTMLButtonElement): Promise<void> {
    if (this.anchor === anchor && !this.menu.hidden) { this.dismiss(true); return; }
    this.dismiss(); const revision = this.menuRevision;
    const root = this.options.root();
    this.menu.replaceChildren();
    this.heading(this.text('操作', 'Actions'));
    this.item(this.text('新建文件', 'New File'), () => this.newFile());
    this.item(this.text('搜索', 'Search'), () => this.options.run('searchFolder'));
    this.item(this.text('在文件管理器中显示', 'Show in File Manager'), () => window.JSBridge.invoke('shell.openItem', root), !root);
    this.item(this.text('打开文件夹…', 'Open Folder…'), () => this.options.run('openFolder'));
    this.item(this.text('刷新', 'Refresh'), () => this.options.refresh());
    this.heading(this.text('排序', 'Sort'));
    const sort = this.options.sort();
    for (const [by, zh, en] of [['natural', '按自然顺序', 'Natural Order'], ['name', '按名称', 'Name'], ['modified', '按修改时间', 'Modified Time']] as const) {
      const item = this.item(this.text(zh, en), () => this.options.setSort(by, sort.descending));
      item.dataset.sort = by; item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(sort.by === by));
    }
    const reverse = this.item(this.text('降序', 'Descending'), () => this.options.setSort(sort.by, !sort.descending));
    reverse.dataset.sort = 'descending'; reverse.setAttribute('role', 'menuitemcheckbox'); reverse.setAttribute('aria-checked', String(sort.descending));
    const recent = await window.JSBridge.invoke('setting.getRecentFolders').catch(() => []) as string[];
    if (revision !== this.menuRevision) return;
    if (recent?.length) {
      this.heading(this.text('最近使用的目录', 'Recent Folders'));
      for (const path of recent.slice(0, 8)) {
        const item = this.item(path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path, () => this.options.run('openFolder', path));
        item.title = path; item.dataset.folder = path;
      }
    }
    this.anchor = anchor; anchor.setAttribute('aria-expanded', 'true'); this.sidebar.classList.add('sidebar-menu-open');
    this.menu.hidden = false;
    this.positionMenu();
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }
  private positionMenu(): void {
    if (this.menu.hidden || !this.anchor?.isConnected) return;
    const rect = this.anchor.getBoundingClientRect(), zoom = Number(getComputedStyle(document.body).zoom) || 1;
    const box = this.menu.getBoundingClientRect();
    this.menu.style.left = Math.max(4, Math.min(rect.right - box.width, window.innerWidth - box.width - 4)) / zoom + 'px';
    this.menu.style.bottom = (window.innerHeight - rect.top + 4) / zoom + 'px';
    this.menu.style.maxHeight = Math.max(60, rect.top - 12) / zoom + 'px';
  }
  async newFile(): Promise<void> {
    this.dismiss();
    let root = this.options.root();
    if (!root) { await this.options.run('openFolder'); root = this.options.root(); if (!root) return; }
    await this.options.run('showCurrentFiles');
    if (root !== this.options.root()) return;
    this.composer?.remove();
    const row = document.createElement('form'); row.id = 'sidebar-new-file-row'; this.composer = row;
    const input = document.createElement('input'); input.value = this.text('未命名.md', 'Untitled.md'); input.setAttribute('aria-label', this.text('文件名', 'File name')); input.autocomplete = 'off'; input.spellcheck = false;
    const error = document.createElement('div'); error.setAttribute('role', 'alert');
    row.append(input, error); document.getElementById('file-library-tree')!.append(row);
    const close = () => { row.remove(); if (this.composer === row) this.composer = undefined; };
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); document.getElementById('sidebar-new-file-btn')!.focus(); } });
    row.addEventListener('submit', event => {
      event.preventDefault(); if (input.disabled) return;
      let name = input.value.trim();
      if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
        error.textContent = this.text('请输入有效的文件名', 'Enter a valid file name'); return;
      }
      if (!/\.[^.]+$/.test(name)) name += '.md';
      error.textContent = '';
      input.disabled = true;
      void this.options.create(root!.replace(/[\\/]+$/, '') + '/' + name).then(created => { if (created) close(); else input.focus(); })
        .catch(reason => { error.textContent = this.text('无法创建文件：', 'Could not create file: ') + String(reason); })
        .finally(() => { input.disabled = false; if (row.isConnected) input.focus(); });
    });
    input.focus(); input.setSelectionRange(0, input.value.lastIndexOf('.')); row.scrollIntoView({ block: 'nearest' });
  }
}
