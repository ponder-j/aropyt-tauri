# 构建与发布

## 环境

使用 Node.js 22+、Rust stable 和 Tauri 2 的系统依赖。在目标平台原生构建；macOS 默认构建当前主机架构。Windows 使用 MSVC 和 WebView2，Linux 使用 WebKitGTK 4.1。Pandoc 是运行时可选工具，不打入安装包。

## 命令

```sh
npm ci
npm run typecheck
npm test
npm run package:dir
npm run package:mac
npm run package:win
npm run package:linux
```

对应命令只能在其目标系统上打包。输出目录为 `src-tauri/target/release/bundle/`。macOS 提供 APP / DMG，Windows 提供 NSIS，Linux 提供 DEB / AppImage。

默认不携带词典。`resources/dictionaries.json` 是固定版本下载清单；独立维护工具 `npm run dictionaries:prepare` 生成的 `release/dictionaries/` 不参与默认打包。

## 自动化

GitHub Actions 在 macOS Apple Silicon 与 Linux ARM 原生环境检查类型、构建 Rust、运行真实 WebView 回归及打包。本次按要求不检查 x64；Windows 保留适配代码和打包入口，但不宣称已验证。Linux 图形检查使用 Xvfb。测试使用临时配置，Pandoc 单独安装；可选词典测试需要网络。

本机 Linux 复现环境：

```sh
docker build -t aropyt-tauri-verify -f tools/linux.Dockerfile .
docker run --rm --shm-size=1g aropyt-tauri-verify
```

## 签名

本地未配置发行证书时，macOS 为本地签名构建，没有 Apple 公证。正式分发应设置 Tauri 的 Apple 签名/公证环境变量；Windows 应配置代码签名。代码签名凭证只通过密钥存储或 CI Secrets 提供，不进入源码。

具体本次验证范围记录在 [迁移核对](migration.md)。原 Electron 版本的历史检查不计为 Tauri 验证。
