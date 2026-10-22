# Aropyt · Tauri 2

轻量 Markdown 桌面编辑器。从 Aropyt 的 Electron 版本迁移至 **Tauri 2 + Rust + 系统 WebView**，保留原有 TypeScript / CodeMirror 6 编辑器、界面、主题和业务交互。

## 功能

- 即时预览与源码模式；标题及行内标记的局部展开。
- 代码框、语言补全、语法高亮、Mermaid 编辑预览；行内和块级 TeX 公式。
- 表格行列编辑、移动、对齐、尺寸面板、TSV 粘贴、统一撤销和输入法合成处理。
- 文件树、大纲、快速打开、查找替换、焦点和打字机模式、多窗口及 macOS 原生标签页。
- 字数统计、动态右键菜单、图片复制/移动/上传、剪贴板富文本、自动保存和恢复草稿。
- 内置及自定义 CSS 主题、完整偏好设置、自定义快捷键、最近文件及编码选择。
- HTML、PDF、PNG、打印；可选 Pandoc 导入和 Word、ODT、Epub、LaTeX、RTF、MediaWiki、rst、Textile、OPML 导出。
- **可选离线拼写检查**：默认关闭，安装包不携带词典。可在偏好设置按语言下载或导入 Hunspell `.aff` / `.dic` 文件。检查在本机执行。

迁移范围、平台验证与原版差异见 [迁移核对](docs/migration.md)；详细操作见 [使用指南](docs/user-guide.md)。

## 开发

需要 Node.js 22+、Rust stable，以及 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。macOS 需 Xcode Command Line Tools；Windows 需 MSVC C++ Build Tools 与 WebView2；Linux 需 WebKitGTK 4.1 开发包。

```sh
npm ci
npm start
```

`npm start` 构建并启动原生应用。`npm run watch` 监听前端改动。前端更改后需刷新窗口；Rust 更改由 Tauri 开发命令处理。

```sh
npm run typecheck
npm test
npm run package:mac   # 在 macOS 构建 APP / DMG
npm run package:win   # 在 Windows 构建 NSIS 安装包
npm run package:linux # 在 Linux 构建 DEB / AppImage
```

安装包输出在 `src-tauri/target/release/bundle/`。Pandoc 不随应用打包，可独立安装并在偏好设置的 Export 页配置路径。

## 可选词典

词典用于**拼写检查，不是语法校验**。开启某种语言时，应用会询问是否下载该语言词典；也可在 **Preferences → Editor → Spell Check** 先下载或导入。英语美式/英式为独立词典。中文、日语沿用原版的英语词典回退策略。

下载源和 SHA-256 固定在 `resources/dictionaries.json`，安装失败不会留下半套词典。已安装词典和用户学习的单词存放在本机数据目录；文稿内容不会用于下载请求。

维护者可以运行 `npm run dictionaries:prepare` 重建清单及独立压缩包；`release/dictionaries/` 不进入应用或源码提交。

## 旧版数据

首次正常启动会将旧版 `aropyt` 数据目录中的配置、主题、草稿、导入资源及粘贴图片**复制**到新的 Tauri 数据目录。原数据不修改、不删除。迁移记录在新目录的 `migration.json`。

macOS 新目录为 `~/Library/Application Support/app.aropyt.tauri/`。其他平台使用 Tauri 的应用数据目录；可以通过 **Preferences → General → Open User Data Folder** 打开。`AROPYT_DATA_DIR` 可以指定隔离目录，自动测试使用这一机制，不接触真实用户配置。

## 验证

`npm test` 在真实系统 WebView 中执行原编辑器回归，并验证文件、编码、草稿、剪贴板、可选词典、Pandoc、PDF/PNG 和多窗口。需要图形桌面；Linux 可使用 `xvfb-run -a npm test`。拼写测试会下载少量词典到临时配置目录。

```sh
npm run test:editor
npm run test:spelling
npm run test:features
npm run test:export
npm run test:packaged # macOS：先构建 APP
```

测试证据生成在 `release/verification/`，不提交。跨平台验证和打包说明见 [构建与发布](docs/releasing.md)。

## 许可证

项目采用 MIT；第三方代码、图标、字体及词典保留原许可证，见 [第三方组件](docs/credits.md)。
