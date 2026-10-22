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

GitHub Actions 在 macOS Apple Silicon 与 Linux ARM 原生环境检查类型、构建 Rust、运行真实 WebView 回归及打包。Windows x64 和 Linux x64 的发行包还需在对应环境运行以下检查。Linux 图形检查使用 Xvfb。测试使用临时配置，Pandoc 单独安装；可选词典测试需要网络。

本机 Linux 复现环境：

```sh
docker build --platform linux/amd64 -t aropyt-tauri-verify -f tools/linux.Dockerfile .
docker run --rm --shm-size=1g -e WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 aropyt-tauri-verify
```

Windows x64 安装 Rust MSVC 工具链、C++ Build Tools、WebView2 和可选 Pandoc 后：

```powershell
npm ci
npm run typecheck
node tools/test-platform.mjs
node tools/wordcount-test.mjs
npm run package:win -- --ci -- --locked
npm run test:packaged
```

上例的 WebKit 沙箱开关仅用于容器内以 root 运行回归测试，不应设置在普通桌面启动环境中。Linux x64 的 DEB / AppImage 在 Docker 容器内构建。镜像设置了 `CARGO_TARGET_DIR=/cargo-target`，因此安装包位于 `/cargo-target/release/bundle/`，`test:packaged` 也会使用这个目录。没有 FUSE 的容器可以设置 `APPIMAGE_EXTRACT_AND_RUN=1` 运行 AppImage。

安装后可用 `AROPYT_TEST_BINARY` 指定实际安装的可执行文件，再运行 `npm run test:packaged`，覆盖安装包资源和系统 WebView；配置和词典仍写入测试临时目录。发布前分别验证 Windows 安装程序、已安装的 DEB 和 AppImage，保留各自的 `release/verification/` 证据，并生成 SHA-256 校验文件。Release 标签必须指向实际构建的源码提交。

## 签名

本地未配置发行证书时，macOS 为本地签名构建，没有 Apple 公证。正式分发应设置 Tauri 的 Apple 签名/公证环境变量；Windows 应配置代码签名。代码签名凭证只通过密钥存储或 CI Secrets 提供，不进入源码。

具体本次验证范围记录在 [迁移核对](migration.md)。原 Electron 版本的历史检查不计为 Tauri 验证。
