[中文](credits.md) | [English](credits.en.md)

# Third-Party Components

The application runs on Tauri 2 (MIT / Apache-2.0), Rust, the system WebView, CodeMirror 6, markdown-it, highlight.js, MathJax, Mermaid, and Photon. Electron, Chromium, and the Node.js runtime are not bundled.

Built-in themes, fonts, and icons retain the original project's files. Font sources and notices are listed in [Font Notices](https://github.com/ponder-j/aropyt-tauri/blob/main/vendor/styles/themes/FONT-LICENSES.md); each resource's original license is retained in its directory.

Optional spelling support uses hunspell-asm (MIT bindings and Hunspell's MPL license) and CLD2 (Apache-2.0). The node-cld native Node bindings have been removed; CLD2 runs through Rust bindings. Dictionaries come from wooorm/dictionaries, LibreOffice, and Hunspell-MS. Fixed sources, versions, checksums, and complete dictionary license texts are recorded in `resources/dictionaries.json`. After downloading, the LICENSE is stored alongside the dictionary in the user data directory.

Pandoc is an optional tool installed separately by the user and retains its own license. The application icon is inherited from the original project.
