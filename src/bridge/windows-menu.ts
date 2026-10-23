import type { MenuItemConstructorOptions as Entry } from './menu-host';
import { normalizeShortcut, shortcutCombo, shortcutHint } from '../shared/shortcuts';

const accessKeys = ['f', 'e', 'p', 'o', 'v', 't', 'h'];

/** Windows chrome uses the same command model as the macOS/GTK native menus. */
export class WindowsMenu {
  private bar = document.createElement('nav');
  private panels: HTMLElement[] = [];
  private entries: Entry[] = [];
  private active = -1;
  private scale = 1;
  private restoreFocus?: HTMLElement;
  constructor(private dispatch: (entry: Entry) => void) {
    this.bar.id = 'aropyt-menubar'; this.bar.setAttribute('role', 'menubar');
    document.body.prepend(this.bar);
    const syncScale = () => {
      const scale = Number(document.body.style.zoom) || 1;
      if (scale !== this.scale) this.close(false);
      this.scale = scale; this.bar.style.zoom = String(1 / scale);
    };
    new MutationObserver(syncScale).observe(document.body, { attributes: true, attributeFilter: ['style'] });
    syncScale();
    document.addEventListener('pointerdown', event => {
      if (!this.bar.contains(event.target as Node) && !this.panels.some(p => p.contains(event.target as Node))) this.close(false);
    }, true);
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close());
    window.addEventListener('keydown', event => this.keydown(event), true);
  }
  update(entries: Entry[]): void {
    this.close(false); this.entries = entries; this.bar.replaceChildren();
    entries.forEach((entry, index) => {
      const button = this.button(entry); button.className = 'aropyt-menubar-item';
      const key = accessKeys[index];
      button.textContent = /[\u3400-\u9fff]/.test(entry.label || '') ? `${entry.label}(${key.toUpperCase()})` : entry.label || '';
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-keyshortcuts', `Alt+${key.toUpperCase()}`); button.tabIndex = index ? -1 : 0;
      button.onclick = () => this.active === index ? this.close() : this.open(index);
      button.onpointerenter = () => { if (this.active >= 0 && this.active !== index) this.open(index); };
      this.bar.append(button);
    });
  }
  private button(entry: Entry): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    button.disabled = entry.enabled === false;
    button.onmousedown = event => event.preventDefault();
    return button;
  }
  private close(restore = true): void {
    const wasOpen = this.active >= 0;
    this.panels.forEach(panel => panel.remove()); this.panels = []; this.active = -1;
    this.bar.querySelectorAll('[aria-expanded]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    if (restore && wasOpen) this.restoreFocus?.focus({ preventScroll: true });
  }
  private open(index: number, focus = false): void {
    if (this.active < 0) this.restoreFocus = document.activeElement as HTMLElement;
    this.close(false); this.active = (index + this.entries.length) % this.entries.length;
    const anchor = this.bar.children[this.active] as HTMLElement;
    anchor.setAttribute('aria-expanded', 'true');
    this.panel(this.entries[this.active].submenu || [], anchor, 0, focus);
  }
  private panel(entries: Entry[], anchor: HTMLElement, level: number, focus = false): void {
    this.panels.splice(level).forEach(p => p.remove());
    const panel = document.createElement('div'); panel.className = 'aropyt-app-menu'; panel.setAttribute('role', 'menu');
    panel.style.zoom = String(1 / this.scale);
    for (const entry of entries) {
      if (entry.type === 'separator') { const separator = document.createElement('div'); separator.className = 'aropyt-menu-separator'; separator.setAttribute('role', 'separator'); panel.append(separator); continue; }
      const button = this.button(entry); button.className = 'aropyt-app-menu-item'; button.tabIndex = -1;
      if (entry.type === 'checkbox' || entry.type === 'radio') {
        button.setAttribute('role', entry.type === 'radio' ? 'menuitemradio' : 'menuitemcheckbox');
        button.setAttribute('aria-checked', String(!!entry.checked));
      }
      const mark = document.createElement('span'); mark.className = 'aropyt-menu-check'; mark.textContent = entry.checked ? '✓' : '';
      const label = document.createElement('span'); label.className = 'aropyt-menu-label'; label.textContent = entry.label || '';
      const hint = document.createElement('span'); hint.className = 'aropyt-menu-hint'; hint.textContent = entry.submenu ? '›' : shortcutHint(entry.accelerator || '', false);
      button.append(mark, label, hint);
      if (entry.submenu) button.setAttribute('aria-haspopup', 'menu');
      button.onpointerenter = () => {
        if (entry.submenu && !button.disabled) this.panel(entry.submenu, button, level + 1);
        else this.panels.splice(level + 1).forEach(p => p.remove());
      };
      button.onclick = () => {
        if (entry.submenu) this.panel(entry.submenu, button, level + 1, true);
        else { this.close(); this.dispatch(entry); }
      };
      button.onkeydown = event => {
        if (event.key === 'ArrowRight' && entry.submenu) { event.preventDefault(); event.stopPropagation(); this.panel(entry.submenu, button, level + 1, true); }
      };
      panel.append(button);
    }
    panel.onkeydown = event => {
      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus(); buttons[next]?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'ArrowLeft' && level) {
        event.preventDefault(); event.stopPropagation(); this.panels.splice(level).forEach(p => p.remove()); anchor.focus();
      }
    };
    document.body.append(panel); this.panels.push(panel);
    const rect = anchor.getBoundingClientRect(), box = panel.getBoundingClientRect();
    panel.style.left = Math.max(0, Math.min(level ? rect.right - 3 : rect.left, window.innerWidth - box.width - 4)) + 'px';
    panel.style.top = Math.max(0, Math.min(level ? rect.top : rect.bottom, window.innerHeight - box.height - 4)) + 'px';
    if (focus) panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  private keydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return;
    const access = event.altKey && !event.ctrlKey && !event.shiftKey ? accessKeys.indexOf(event.key.toLowerCase()) : -1;
    if (event.key === 'F10' && this.active >= 0) { event.preventDefault(); this.close(); return; }
    if (access >= 0 || event.key === 'F10') { event.preventDefault(); this.open(access >= 0 ? access : 0, true); return; }
    if (this.active >= 0 && event.key === 'Tab') { this.close(); return; }
    if (this.active >= 0 && event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (this.active >= 0 && this.panels.length <= 1 && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      // Submenu arrows are handled by the focused item below.
      if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup') === 'menu' && !this.bar.contains(document.activeElement)) return;
      event.preventDefault(); this.open(this.active + (event.key === 'ArrowRight' ? 1 : -1), true); return;
    }
    const combo = shortcutCombo(event, false);
    const field = (event.target as HTMLElement)?.closest('input,textarea,select');
    const walk = (items: Entry[]): Entry | undefined => {
      for (const entry of items) {
        if (entry.enabled === false) continue;
        if (entry.accelerator && normalizeShortcut(entry.accelerator) === combo && !entry.submenu) return entry;
        const match = entry.submenu && walk(entry.submenu); if (match) return match;
      }
    };
    const entry = combo && walk(this.entries);
    const fileAction = entry && ['save', 'saveAs', 'new', 'newWindow', 'open', 'openQuickly', 'preferences', 'close'].includes(entry.action || '');
    if (!entry || field && !fileAction && (entry.registerAccelerator === false || entry.role)) return;
    // Table widgets and CodeMirror selection/edit keys keep their own handlers.
    if ((event.target as HTMLElement)?.closest('td[data-row],th[data-row]') && ['Ctrl+Enter', 'Ctrl+Shift+Backspace'].some(k => normalizeShortcut(k) === combo)) return;
    if (['cut', 'copy', 'paste', 'selectAll'].includes(entry.role || '') || entry.action === 'selectAll') return;
    event.preventDefault(); this.close(); this.dispatch(entry);
  }
}
