export interface MenuItemConstructorOptions { label?: string; role?: string; type?: string; accelerator?: string; registerAccelerator?: boolean; checked?: boolean; enabled?: boolean; submenu?: MenuItemConstructorOptions[]; event?: 'menu' | 'open-file' | 'bridge'; action?: string; arg?: unknown }
export type Menu = MenuItemConstructorOptions[];
export const platform = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux';
let settings: Record<string, any> = {};
export function setMenuSettings(value: Record<string, any>): void { settings = value; }
export function loadSettings(): any { return settings; }
export const app = { getLocale: () => navigator.language };
export const Menu = { buildFromTemplate: (t: MenuItemConstructorOptions[]) => t, setApplicationMenu: (_m: Menu) => {} };

// A menu belongs to the application, while its receiving window may still have
// an older recent-file/theme list. Carry commands through the native menu instead
// of resolving positions against a per-window table of JavaScript callbacks.
export function serializeMenu(entries: MenuItemConstructorOptions[], generation: string): any[] {
  let counter = 0;
  const walk = (items: MenuItemConstructorOptions[]): any[] => items.map(entry => ({
    ...entry,
    id: `menu-${generation}-${counter++}`,
    submenu: entry.submenu ? walk(entry.submenu) : undefined,
  }));
  return walk(entries);
}
