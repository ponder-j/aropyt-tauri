# Windows 更新发布

Windows 启动后自动检查 GitHub Release 的 `latest.json`。用户也可从帮助菜单手动检查。仅在确认后下载；Tauri updater 使用内嵌公钥校验安装包。下载完成后保存所有窗口，取消保存则取消安装。安装前 Rust 还会检查所有窗口的未保存状态。NSIS 使用 passive 模式覆盖当前目录，安装后重新打开应用。

Windows 更新签名配置位于 `src-tauri/tauri.conf.json`，生成签名由 `src-tauri/tauri.windows.conf.json` 启用。其他平台的软件包目前仍通过 Release 手动下载。

发布运行 `tools/release-windows.ps1`。本机签名私钥存放在 `~/.tauri/aropyt-updater.key`，CI 使用仓库的 `TAURI_SIGNING_PRIVATE_KEY` Secret。私钥必须单独备份，不能提交到源码库；后续发布应持续使用该密钥。此签名用于应用内更新验证，独立于 Windows Authenticode 签名。

Release 必须同时包含安装包、同名 `.exe.sig` 和 `latest.json`；发布脚本会生成清单及 SHA-256 校验。先上传验证通过的安装包与签名，再上传更新清单，使更新检查只看到已可下载的产物。

`npm run test:updates` 验证取消、下载失败、签名错误和保存取消等流程。`tools/verify-windows-installer.ps1` 在临时目录安装真实包、执行完整 WebView 回归及原生签名/版本检查，并恢复本机注册信息；加 `-InstallUpdate` 会从 GitHub 下载实际包，验证覆盖安装和重启。
