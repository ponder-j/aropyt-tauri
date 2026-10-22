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

普通分支推送和 PR 继续运行 macOS Apple Silicon / Linux ARM 验证。`.github/workflows/release.yml` 在推送 `v*` 版本 tag 时自动构建和发布 Windows x64 与 Docker Linux x64：

1. 校验 tag 与 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中的版本完全一致。
2. Windows 2022 x64 构建 NSIS，静默安装后对已安装程序运行完整 WebView 回归，最后卸载测试安装。
3. Ubuntu x64 runner 使用 `tools/linux.Dockerfile` 构建 Debian 12 amd64 镜像；在容器内构建 DEB / AppImage，分别运行已安装 DEB 和 AppImage 的完整回归。
4. 两平台成功后，再核对三个安装包的哈希、测试平台、检查数量及源码提交，汇总测试证据和 SHA-256 校验和。只有发布任务拥有 `contents: write`，使用内置 `GITHUB_TOKEN` 创建草稿、上传全部附件后公开 Release。

`v1.2.3-beta.1` 一类预发布 tag 自动标记为 prerelease；稳定版设为 latest。已公开的同名 Release 不会被覆盖。失败时保留 Actions 测试证据；重跑可以恢复尚未公开的草稿。Actions 页的 **Release x64 → Run workflow** 执行相同构建、测试、附件汇总，但不创建或修改 Release，最终文件可从 `release-files` artifact 下载。

发布新版本时，先同步上述五个文件（`npm version 1.0.1 --no-git-tag-version` 可更新 npm 的两个文件，Rust 锁文件用 Cargo 更新），提交后推送对应 tag：

```sh
git tag -a v1.0.1 -m "Aropyt 1.0.1"
git push origin main
git push origin v1.0.1
```

Linux 图形检查使用 Xvfb；测试使用临时配置。Pandoc 单独安装，可选词典测试需要网络。Windows 发行包暂未配置签名证书。

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

## Linux ARM64 独立发布

在 aarch64 主机或原生 ARM64 Docker 环境中运行 `sh tools/release-linux-arm64.sh`，生成 ARM64 DEB 和 aarch64 AppImage，并分别对已安装 DEB 和实际 AppImage 执行完整回归。该脚本需要安装 DEB 的权限；容器中使用上文所述的 Xvfb 和测试沙箱设置。

也可以在仅安装运行依赖的 Debian 12 ARM64 环境中，设置 `AROPYT_TEST_BINARY=/usr/bin/aropyt` 后运行 `node tools/verify-packaged.mjs linux-arm64-deb /usr/bin/aropyt <deb路径>`。AppImage 使用 `linux-arm64-appimage` 标签；无 FUSE 的环境额外设置 `APPIMAGE_EXTRACT_AND_RUN=1`。

ARM64 的独立 Release 使用 `linux-arm64-v<版本>` 标签，附件包含 DEB、AppImage、测试证据和 SHA-256 校验文件。该标签不触发现有的 `v*` x64 发布流程；本轮 ARM64 发布不要求执行 x64 验证。发布前必须确认两种安装产物均通过至少 84 项检查，且附件哈希与测试证据对应。

## 签名

本地未配置发行证书时，macOS 为本地签名构建，没有 Apple 公证。正式分发应设置 Tauri 的 Apple 签名/公证环境变量；Windows 应配置代码签名。代码签名凭证只通过密钥存储或 CI Secrets 提供，不进入源码。

具体本次验证范围记录在 [迁移核对](migration.md)。原 Electron 版本的历史检查不计为 Tauri 验证。
