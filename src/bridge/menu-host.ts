export interface MenuItemConstructorOptions { label?: string; role?: string; type?: string; accelerator?: string; registerAccelerator?: boolean; checked?: boolean; enabled?: boolean; submenu?: MenuItemConstructorOptions[]; click?: () => void }
export type Menu = MenuItemConstructorOptions[];
export const platform = /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux';
let settings: Record<string, any> = {};
export function setMenuSettings(value: Record<string, any>): void { settings = value; }
export function loadSettings(): any { return settings; }
export const app = { getLocale: () => navigator.language };
export function clearRecentFiles(): void { settings.recentFiles = []; settings.recentFolders = []; void window.JSBridge.invoke('setting.clearRecentDocuments'); }
export const Menu = { buildFromTemplate: (t: MenuItemConstructorOptions[]) => t, setApplicationMenu: (_m: Menu) => {} };
