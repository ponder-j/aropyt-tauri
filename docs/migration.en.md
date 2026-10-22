[中文](migration.md) | [English](migration.en.md)

# Tauri 2 Migration Checklist

This project was migrated from the original Aropyt's complete workspace. The original project revision is recorded in [source-baseline.json](source-baseline.json). The editor and interface retain their original implementations; Rust / Tauri 2 provides windows, system interfaces, and persistence.

## Feature Mapping

| Original feature | Tauri implementation and verification |
| --- | --- |
| Live editing, source mode, headings and inline markers, formatting commands | Retains the CodeMirror / Markdown implementation; the original 67 editor regressions run in the system WebView. |
| Code blocks, languages, completion, syntax highlighting, Mermaid | Retains the original implementation, including the diagram preview below its code while editing, language switching, and undo. |
| Inline math, block math, math in tables | Retains MathJax and local TeX editing; export preserves SVG while hiding duplicate visual content from assistive MathML. |
| Table navigation, row and column operations, dimensions, paste, input methods, undo | Retains the original implementation; regressions cover TSV, IME composition events, boundaries, and adjacent content. |
| File tree, outline, quick open, find and replace, focus mode, typewriter mode | Retains the original frontend; Rust provides directory, search, and file operations. |
| File encoding, save rules, rename, move, Trash | Implemented in Rust; checks real UTF-16 / UTF-8 reads and writes, trailing whitespace, final newlines, and CRLF. |
| Drafts, autosave, recent files, multiple windows, Save All | Retains frontend workflows; Rust provides drafts and window state. Canceling does not discard unsaved content. |
| Native macOS tabs, Window menu, fullscreen, always on top | Tauri windows and AppKit tab groups; retains the original menu model and languages. |
| Default and custom shortcuts | Retains frontend keyboard handling. Menu shortcuts owned by the editor are not registered as global native shortcuts, so they do not intercept table input or custom bindings. |
| Statistics, spelling language panel, dynamic context menu | Retains the original controllers and menus; local Hunspell WASM + CLD2, with spelling underlines added in the system WebView. |
| Themes, fonts, preferences | Retains all built-in themes, fonts, and preference options; images and fonts referenced by local CSS are embedded in previews and exports. |
| Images, uploaders, rich clipboard, Save Media As | Rust / system clipboard and the original image rules; supports PicGo/PicList and user-configured commands. |
| HTML, PDF, PNG, printing | Uses the complete static export document rendered by the system WebView. macOS uses asynchronous native paginated printing and releases windows and resources on the main thread. |
| Nine conversions, including Word, ODT, Epub, and LaTeX, plus import | Pandoc integration moved to Rust; verifies actual files, Word tables/editable equations/diagrams, HTML image dimensions, and persistent LaTeX resources. |
| Old configuration, themes, recovery drafts, user dictionaries | Copies into a separate data directory on first launch, retains the old directory, and does not overwrite existing destination files. |

The migration baseline preserves the original editor and interface, with the platform bridge handling system WebView differences. Subsequent comparison with local Typora added mixed inline images, reference-style images, footnotes, local editing and file context actions for images in tables, footnotes in tables, hover previews and return-to-reference navigation, Setext ranges, and the horizontal find bar. Current behavior and remaining differences are recorded in [Feature Details](typora-parity.md). The bottom bar and DOM context menu retain the Windows/newer-reference layout requested by the user; the interface has not been redesigned.

## User-Approved Adjustments

Offline dictionaries are for spell check, not grammar checking. Spell check is off by default and dictionaries are not installed. Users can confirm a download when enabling a language, or download or import local `.aff` / `.dic` files in Preferences. All original language modes remain available. Download versions and SHA-256 checksums are fixed. Dictionary checks, language detection, and learned words remain local.

The original application's Electron / Chromium / Node.js runtimes are not bundled. Pandoc remains an optional external dependency.

## Verification Scope

Initial migration verification covered ARM. The 84 actual WebView checks passed on macOS Apple Silicon, together with path/URL regressions, 13 sets of reference word-count data, and type checking. Original Electron test scripts are archived in `tests/electron-reference/` and do not count as verification of the new application. Build and release procedures are described in [Building and Releasing](releasing.md). Current verification is scoped to ARM; x64 results are not included in this round.

Coverage includes actual files, clipboard operations, drafts, canceled saves, dictionary downloads and checksums, offline checking, suggestions and learned words, CLD2 detection, nine Pandoc formats, native PDF / PNG, multiple windows, and tabs. Long-document PDF checks include pagination, A4 pages, and text at the end of the document. Export preserves selectable text and vector math/diagrams.

The macOS APP / DMG is built natively on the local ARM machine. The default APP is approximately 20 MiB and the DMG approximately 15 MiB, compared with about 400 MiB for the local old Electron APP: roughly a 95% reduction in APP size. Dictionaries are not included in the installer.

Linux ARM (aarch64, Docker / Xvfb / WebKitGTK) also passed the full 84 checks. Fixes address zoom geometry differences in older WebKitGTK and allow the separate export window to take a native screenshot after it is mapped. These ARM results do not establish x64 installer compatibility. Differences inherited from the original project remain documented in [Feature Details](typora-parity.md).

Historical verification after the local Typora comparison and sidebar fixes on 2026-10-22 passed 109 offline regressions on each of the macOS ARM package and Linux ARM. An earlier Linux ARM run that included online dictionary downloads recorded 110 passes. The feature details above contain the latest regression counts after subsequent editing improvements, comparison steps, network verification limits, and remaining differences.

Run sidebar interface regressions with `node tools/test-tauri.mjs --packaged --offline` for the macOS package or `node tools/test-tauri.mjs --no-build --offline` for an already-built ARM application. `--offline` excludes only dictionary download/install checks that require a live CDN. It retains checks for absent dictionaries by default, editing, sidebar behavior, files, canceled saves, and export. The default run without this flag still verifies online downloads and WASM spelling. CDN connections may fail intermittently; network and interface results should be recorded separately.
