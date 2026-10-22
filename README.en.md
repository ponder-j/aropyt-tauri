[中文](README.md) | [English](README.en.md)

# Aropyt · Tauri 2

A lightweight Markdown desktop editor, migrated from the Electron version of Aropyt to **Tauri 2 + Rust + the system WebView**, retaining the existing TypeScript / CodeMirror 6 editor, interface, themes and application behavior.

## Features

- Live preview and source mode, with local expansion of heading and inline Markdown markers.
- Code fences, language completion, syntax highlighting and editable Mermaid previews; inline and display TeX equations.
- Table row and column editing, moving, alignment, a size picker, TSV paste, shared undo history and input-method composition handling.
- File tree, outline, quick open, find and replace, focus and typewriter modes, multiple windows and native macOS tabs.
- Word count, context-sensitive menus, image copying/moving/uploading, rich-text clipboard support, automatic saving and recoverable drafts.
- Built-in and custom CSS themes, full preferences, custom shortcuts, recent files and encoding selection.
- Simplified Chinese and English interfaces, with an option to follow the system language. Menus, preferences, messages and accessibility labels switch together. Markdown, LaTeX, product names and programming language names retain their original names; documents, paths and user input are never translated.
- HTML, PDF and PNG export and printing; optional Pandoc import and export to Word, ODT, Epub, LaTeX, RTF, MediaWiki, rst, Textile and OPML.
- **Optional offline spell checking**: disabled by default, with no dictionaries bundled in the installer. Download a dictionary for a selected language in Preferences or import Hunspell `.aff` / `.dic` files. Checking runs locally.

See the [migration checklist](docs/migration.en.md) for migration scope and platform verification, the [user guide](docs/user-guide.en.md) for instructions, and the [Typora parity record](docs/typora-parity.md) for specific differences. Complex editing across blocks, some nested lists containing rich content, comprehensive code formatting and grammar correction still differ; the project does not claim complete parity with Typora. Windows-style layouts and interactions explicitly retained in that record remain intentional.

## Installation and interface language

Release files are available through [GitHub Releases](https://github.com/ponder-j/aropyt-tauri/releases). macOS ARM uses APP / DMG packages; Linux ARM uses DEB / AppImage packages. You can also build the application as described below. Current local comparisons and regression work cover macOS ARM and Linux ARM; historical checks on other platforms are recorded separately in [building and releasing](docs/releasing.md).

Choose Simplified Chinese, English or the system language under **Help → Interface Language**, or **Preferences → General → Language**. Changes apply immediately, without restarting.

## Development

Requires Node.js 22+, stable Rust and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/). macOS requires Xcode Command Line Tools; Windows requires MSVC C++ Build Tools and WebView2; Linux requires the WebKitGTK 4.1 development packages.

```sh
npm ci
npm start
```

`npm start` builds and launches the native application. `npm run watch` rebuilds TypeScript frontend changes; rerun `npm run build` after changing HTML, CSS, or static assets. Refresh the window after rebuilding the frontend; the Tauri development command handles Rust changes.

```sh
npm run typecheck
npm test
npm run package:mac   # Build APP / DMG on macOS
npm run package:win   # Build the NSIS installer on Windows
npm run package:linux # Build DEB / AppImage on Linux
```

Packages are written to `src-tauri/target/release/bundle/`. Pandoc is not bundled; install it separately and configure its path under **Preferences → Export**.

## Optional dictionaries

Dictionaries provide **spell checking, not grammar checking**. When a language is enabled, the application asks whether to download its dictionary. You can also download or import dictionaries first under **Preferences → Editor → Spell Check**. US and UK English use separate dictionaries. Chinese and Japanese retain the original application's English-dictionary fallback behavior.

Download sources and SHA-256 checksums are pinned in `resources/dictionaries.json`. A failed installation does not leave a partially installed dictionary. Installed dictionaries and learned words are stored in the local application data directory; document content is never included in download requests.

Maintainers can run `npm run dictionaries:prepare` to rebuild the manifest and separate archives. `release/dictionaries/` is excluded from the application and source commits.

## Existing application data

On the first normal launch, configuration, themes, drafts, imported resources and pasted images from the old `aropyt` data directory are **copied** to the new Tauri data directory. Original data is neither modified nor deleted. Migration is recorded in `migration.json` in the new directory.

On macOS, the new directory is `~/Library/Application Support/app.aropyt.tauri/`. Other platforms use Tauri's application data directory. Open it through **Preferences → General → Open User Data Folder**. Set `AROPYT_DATA_DIR` to use an isolated directory; automated tests use this mechanism without touching real user settings.

## Verification

`npm test` runs editor regression checks in the actual system WebView and verifies files, encodings, drafts, the clipboard, optional dictionaries, Pandoc, PDF/PNG and multiple windows. A graphical desktop is required; on Linux, use `xvfb-run -a npm test` if necessary. Spelling tests download a small number of dictionaries into a temporary profile.

```sh
npm run test:editor
npm run test:spelling
npm run test:features
npm run test:export
npm run test:packaged # macOS: build the APP first
```

To skip online dictionary download checks, run:

```sh
node tools/test-tauri.mjs --offline
node tools/test-tauri.mjs --packaged --offline # macOS: check the built APP
```

`--offline` excludes live dictionary download checks while still testing the default state without dictionaries, editing, files, export and other features. See the [Typora parity record](docs/typora-parity.md) for the latest passing check counts, platforms and verification limits. Test evidence is written to `release/verification/` and is not committed. See [building and releasing](docs/releasing.md) for cross-platform verification and packaging details.

## License

The project uses MIT. Third-party code, icons, fonts and dictionaries retain their original licenses; see [third-party components](docs/credits.en.md).
