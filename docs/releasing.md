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

macOS 打包后还应运行 `npm run test:macos-launch`，或用 `node tools/test-macos-launch.mjs /Applications/Aropyt.app` 检查安装版。该测试通过 LaunchServices 打开应用，覆盖多文件冷启动、运行中打开文件、恢复上次文稿和普通启动，使用独立临时配置。直接运行可执行文件的 WebView 回归不会覆盖初始化前收到的 Apple Events。

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

## 四平台统一发布

需要将 macOS ARM64、Linux ARM64、Windows x64 和 Linux x64 汇总到同一 Release 时，在草稿说明中加入 `<!-- aropyt-unified-release -->`。标签触发的 x64 流程仍完整构建、安装测试并汇总证据，发布步骤识别该标记后把附件汇总与公开操作交给统一发布流程，避免覆盖其他平台附件。统一发布必须校验六个安装包的源码提交、测试结果及哈希，再上传全部附件并核对 GitHub 返回的 SHA-256 后公开。

## 签名

本地未配置发行证书时，macOS 为本地签名构建，没有 Apple 公证。正式分发应设置 Tauri 的 Apple 签名/公证环境变量；Windows 应配置代码签名。代码签名凭证只通过密钥存储或 CI Secrets 提供，不进入源码。

具体本次验证范围记录在 [迁移核对](migration.md)。原 Electron 版本的历史检查不计为 Tauri 验证。

## macOS 签名更新包

`npm run release:mac` 原生构建 APP / DMG，以及 Tauri 签名的 `.app.tar.gz` 更新包。脚本递增 `src-tauri/updater-build.json` 中的秒级构建标识，构建标识同时嵌入可执行程序和 APP 资源；`latest-macos.json` 的 `pub_date` 使用同一日期，不能使用上传时的当前时间。版本号不变时，只有更晚的构建才会提示更新。下载及安装前还核对签名包内部构建标识与清单，拒绝通过修改日期重贴旧包标签。

Mac 使用 `src-tauri/tauri.macos.conf.json` 中的独立公钥和 `latest-macos.json` 端点，不改 Windows 的 `latest.json`。私钥默认位于 `~/.tauri/aropyt-macos-updater.key`，也可通过 `TAURI_SIGNING_PRIVATE_KEY` 指定；私钥不提交或打入附件。首次设置后须保留同一签名密钥，公钥提交到平台配置。普通 `package:mac` 仍可构建不带更新附件的安装包；正式更新发布使用 `release:mac`。

更新文件位于 `release/macos-updater/artifacts/`。上传 DMG、带构建标识的 `.app.tar.gz` 及 `.sig` 后，再上传 `latest-macos.json`；同步发布验证包与聚合 SHA-256，保留其他平台附件。先对从 DMG 取出的独立安装副本运行完整 WebView 与 LaunchServices 回归，再用 `tools/test-macos-updater.mjs <隔离安装的Aropyt.app> <签名tar.gz>` 运行下载、篡改拒绝、保存取消、多窗口保护、覆盖安装和真实重启回归；发布后加 `--online` 验证 GitHub 下载及正式更新检查。该脚本拒绝对 `/Applications` 安装版运行覆盖测试。

Mac 更新会在保存完成后暂时禁用窗口输入，最终再次检查文稿是否未保存。安装完成后，独立的重启进程等待旧进程结束，再通过 LaunchServices 打开应用，防止单实例转发到正在退出的旧进程。已保存的文稿列表保存在用户数据目录中的一次性重启记录里，不改变用户的常规启动偏好。

Mac 更新客户端启用原生系统代理发现；`updateProxy` 为空时使用系统/环境代理，偏好设置的显式 HTTP/HTTPS 代理会用于清单和更新包请求。线上更新测试会去除子进程中的所有代理环境变量，并通过临时偏好设置配置测试代理，覆盖从桌面启动时的联网条件。Mac 强制校验签名中绑定的版本。
