type Panel = 'files' | 'outline' | 'search';

interface SidebarSearchOptions {
  lang(): 'zh' | 'en';
  panel(): Panel;
  show(panel: Panel): void;
  search(): Promise<void>;
}

/** Windows-style pull-down search, with the same options as document find. */
export class SidebarSearch {
  private readonly sidebar = document.getElementById('aropyt-sidebar')!;
  private readonly tabs = document.getElementById('sidebar-tabs')!;
  private readonly reveal = document.getElementById('sidebar-search-reveal')!;
  private readonly input = document.getElementById('file-library-search-input') as HTMLInputElement;
  private readonly buttons = [
    ['sidebar-search-case', '区分大小写', 'Case Sensitive'],
    ['sidebar-search-word', '查找整个单词', 'Match Whole Word'],
    ['sidebar-search-regex', '正则表达式', 'Regular Expression'],
  ] as const;

  constructor(private options: SidebarSearchOptions) {
    this.tabs.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(this.tabs.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(tab => !tab.hidden);
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      this.options.show(tabs[next].dataset.panel as Panel); tabs[next].focus();
    });
    this.input.addEventListener('input', () => void this.options.search());
    this.reveal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        this.options.show('files');
        document.getElementById('sidepanel-segmented-input-files')!.focus();
      } else if (event.key === 'Enter' && event.target === this.input) {
        event.preventDefault(); void this.options.search();
      }
    });
    for (const [id] of this.buttons) {
      const button = document.getElementById(id)!;
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        const active = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(active)); button.classList.toggle('active', active);
        void this.options.search();
      });
    }
    this.sidebar.addEventListener('wheel', event => {
      if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
          this.options.panel() === 'search' || this.sidebar.inert) return;
      const atTop = document.getElementById('sidebar-content')!.scrollTop <= 0;
      // Pulling at the top reveals search without taking over normal list
      // scrolling. Scrolling down on the tab strip is also a direct entrance.
      if ((atTop && event.deltaY < 0) || (this.tabs.contains(event.target as Node) && event.deltaY > 0)) {
        event.preventDefault(); this.options.show('search');
      }
    }, { passive: false });
  }

  get filters(): { caseSensitive: boolean; wholeWord: boolean; regex: boolean } {
    const active = (id: string) => document.getElementById(id)!.getAttribute('aria-pressed') === 'true';
    return { caseSensitive: active('sidebar-search-case'), wholeWord: active('sidebar-search-word'), regex: active('sidebar-search-regex') };
  }

  update(panel: Panel): void {
    const search = panel === 'search', zh = this.options.lang() === 'zh';
    this.sidebar.classList.toggle('sidebar-search-open', search);
    this.reveal.inert = !search; this.reveal.setAttribute('aria-hidden', String(!search));
    document.getElementById('sidepanel-segmented-input-outline')!.hidden = search;
    document.getElementById('sidebar-search-btn')!.hidden = !search;
    for (const [id, cn, en] of [
      ['sidepanel-segmented-input-files', '文件', 'Files'],
      ['sidepanel-segmented-input-outline', '大纲', 'Outline'],
      ['sidebar-search-btn', '查找', 'Search'],
    ]) {
      const tab = document.getElementById(id)!;
      const selected = tab.dataset.panel === panel;
      tab.textContent = zh ? cn : en; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    this.tabs.setAttribute('aria-label', zh ? '侧边栏' : 'Sidebar');
    this.reveal.querySelector('[role="group"]')!.setAttribute('aria-label', zh ? '查找选项' : 'Search options');
    this.input.placeholder = zh ? '查找' : 'Search'; this.input.setAttribute('aria-label', zh ? '查找文件内容' : 'Search file contents');
    for (const [id, cn, en] of this.buttons) {
      const button = document.getElementById(id)!;
      button.title = zh ? cn : en; button.setAttribute('aria-label', button.title);
    }
  }
}
