# 第三方组件

应用运行时使用 Tauri 2（MIT / Apache-2.0）、Rust、系统 WebView、CodeMirror 6、markdown-it、highlight.js、MathJax、Mermaid 和 Photon。没有打包 Electron、Chromium 或 Node.js 运行时。

内置主题、字体和图标保留原项目文件。字体来源及通知见 [字体说明](../vendor/styles/themes/FONT-LICENSES.md)，各资源原有许可证保留在目录中。

可选拼写功能使用 hunspell-asm（MIT 绑定及 Hunspell 的 MPL 许可）和 CLD2（Apache-2.0）。已移除 node-cld 的 Node 原生绑定，CLD2 通过 Rust 绑定执行。词典来自 wooorm/dictionaries、LibreOffice 和 Hunspell-MS，固定来源、版本、校验和及各词典的许可证全文在 `resources/dictionaries.json` 中；下载后 LICENSE 与词典一同存放在用户数据目录。

Pandoc 是用户独立安装的可选工具，保留其自身许可证。应用图标沿用原项目图标。
