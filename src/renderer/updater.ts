import { uiText } from '../shared/ui-language';

type Invoke = (method: string, ...args: any[]) => Promise<any>;
type UpdateInfo = { version: string; currentVersion: string; body?: string };

/** One controller per window; the native bridge serializes all windows. */
export class UpdateController {
  private busy = false;
  constructor(private invoke: Invoke, private notify: (text: string, kind?: 'info' | 'success' | 'error', ms?: number) => void) {}
  private async call(method: string, ...args: any[]): Promise<any> {
    const result = await this.invoke(method, ...args);
    if (result?.error) throw new Error(result.error);
    return result;
  }
  async startup(): Promise<void> {
    if (await this.call('update.claimStartup')) await this.check(false);
  }
  async check(manual = true): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (manual) this.notify(uiText('正在检查 GitHub 更新…', 'Checking GitHub for updates…'), 'info', 30000);
      const update: UpdateInfo | null = await this.call('update.check');
      if (!update) {
        if (manual) this.notify(uiText('已是最新版本。', 'You are up to date.'), 'success');
        return;
      }
      const answer = await this.call('dialog.showMessageBox', {
        title: uiText('Aropyt 更新', 'Aropyt Update'),
        message: uiText(`发现新版本 ${update.version}`, `Aropyt ${update.version} is available`),
        detail: uiText(`当前版本：${update.currentVersion}。确认后将下载更新、保存所有文稿并退出，安装程序会自动覆盖安装并重新打开 Aropyt。`,
          `Current version: ${update.currentVersion}. The update will download, save your documents and close Aropyt, then install over the current version and reopen the app.`) + (update.body ? '\n\n' + update.body : ''),
        buttons: [uiText('下载并安装', 'Download and install'), uiText('稍后', 'Later')], defaultId: 1, cancelId: 1,
      });
      if (answer.response !== 0) return;
      this.installing = true;
      this.notify(uiText('正在下载并验证更新…', 'Downloading and verifying update…'), 'info', 600000);
      await this.call('update.download');
      // A cancelled Save As aborts installation and leaves every editor open.
      if (!(await this.call('document.saveAll'))) {
        this.notify(uiText('已取消安装，文稿保持打开。', 'Installation cancelled. Your documents remain open.'));
        return;
      }
      this.notify(uiText('正在安装更新，Aropyt 将自动重新打开…', 'Installing update. Aropyt will reopen automatically…'), 'info', 600000);
      await this.call('update.install');
    } catch (error) {
      if (manual || this.installing) this.notify(uiText('更新失败：', 'Update failed: ') + String(error instanceof Error ? error.message : error), 'error', 12000);
      else console.info('Automatic update check:', String(error));
    } finally {
      await this.call('update.clear').catch(() => {});
      this.busy = false; this.installing = false;
    }
  }
  private installing = false;
  progress(received: number, total?: number): void {
    this.installing = true;
    const detail = total ? Math.min(100, Math.round(received / total * 100)) + '%' : (received / 1048576).toFixed(1) + ' MB';
    this.notify(uiText('正在下载更新… ', 'Downloading update… ') + detail, 'info', 600000);
  }
}
