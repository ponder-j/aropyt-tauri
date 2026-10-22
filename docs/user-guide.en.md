[中文](user-guide.md) | [English](user-guide.en.md)

# Aropyt User Guide

This guide describes the operations currently available. Supported behavior and remaining differences are recorded in [Feature Status and Typora Differences](typora-parity.md); see the [project README](https://github.com/ponder-j/aropyt-tauri/blob/main/README.en.md) for build instructions.

## Getting Started

Open a Markdown file, or create a document and start typing. Code blocks retain their code editor, with a language field in the lower-right corner and language icons in its suggestions. Enter confirms the language and keeps focus in the field; Tab returns to the code. Click a Mermaid diagram to expand its code above the live preview. The code collapses when the cursor leaves.

The shortcuts below use macOS names. Save: Command+S; source mode: Command+/; find: Command+F; replace: Command+H. The corresponding Windows/Linux bindings use Ctrl. Current verification targets macOS ARM and Linux ARM; see [Feature Status and Typora Differences](typora-parity.md) for the latest results and limits. Build instructions are in [Building and Releasing](releasing.md).

## Markdown

Enter starts a new paragraph. Shift+Enter adds a line break within the current paragraph or list item. Backspace at the beginning of a paragraph joins it to the previous paragraph.

Use `# Heading` to create a heading. Bold is `**text**`, italic is `*text*`, links are `[name](address)`, and images are `![description](address)`. The Paragraph menu provides tables, code blocks, math, task lists, footnotes, and a table of contents. You can edit text directly in simple quotes and lists. Click inline math to edit its TeX with a floating preview. Click a standalone image to reveal its Markdown while keeping its preview visible.

The context menu in the document has four clipboard icons and two rows of formatting buttons. Depending on the content, it offers heading, insertion, image, code, or table submenus. Right-clicking preserves the current selection, which is restored before a command runs. Use the arrow keys to navigate, Right to open a submenu, Left to go back, Enter to execute, and Escape to close. Source mode offers only Cut, Copy, and Paste.

The code source area offers Copy Code Content and commands to adjust indentation for the selection or the whole code block. Indenting a selection takes the surrounding block into account; the command is unavailable for a selection outside the block. Rendered math and Mermaid previews do not show code commands. Diagrams can be copied as images or saved as SVG/PNG. Math can also be copied as TeX, MathML, or equation HTML for pasting into Word.

Clicking a heading preserves its formatting. Backspace at the beginning of its text removes the heading format. Source mode lets you edit Markdown markers directly.

## Tables

Type `| Header One | Header Two |` and press Enter to create a table and enter the first cell. Edit directly in each cell. When the cursor enters bold, italic, code, or a link, only that span's Markdown markers expand; adjacent formatting remains rendered. Click math in a cell to edit its TeX with a floating preview; leaving it restores the rendered formula. Tab moves to the next cell and adds a row at the last cell. Shift+Tab moves back. Enter moves to the next row; Shift+Enter inserts a line break within the cell. Command+Enter inserts a row below the current row, and Command+Shift+Backspace deletes the current row. The toolbar above the table provides alignment controls; its left button opens a size grid. Enter row and column counts to create larger tables. The context and Paragraph menus provide row and column insertion and deletion. The context menu's Table submenu also offers row and column movement (Alt+arrow keys), copying, and formatting. You can paste multiple cells from a spreadsheet. Table changes are included in the document's shared undo history.

## Selection and Deletion

Edit → Select provides selection of a paragraph or block, the current line or sentence, formatted text, and a word. Edit → Delete Range provides the corresponding deletion actions. These commands work by sentence in ordinary text, by code line in a code block, and by the entire current row in a table. Command+Option+Shift+L deletes the current line or sentence.

Selecting formatted text selects only its content; deleting formatted text also removes its formatting markers. Changes can be undone.

## Import and Export

HTML, PDF, and PNG use the application's built-in engines. Export waits for diagrams and math and then exports the complete document, regardless of the selection, source mode, or scroll position.

Word, OpenOffice, Epub, LaTeX, and other document formats use Pandoc. Configure the Pandoc executable in the Export preferences page; common installation paths are detected automatically. Import also uses Pandoc.

Word export preserves table and equation structure and converts Mermaid diagrams to images. HTML images are also embedded with their scaled dimensions. Images referenced by text formats such as LaTeX are saved in an assets folder beside the exported file; include that folder when sharing the export.

## Images

Use Format → Image to insert an image from a web address or choose a local image. Preferences can copy images into the document directory, an assets folder, a separate assets folder for each document, or a custom directory.

Right-click a standalone image to open its location, copy or move the file, upload it, copy its image content, choose a zoom of 25%, 33%, 50%, 67%, 80%, 100%, 150%, or 200%, or switch between Markdown and HTML syntax. Deleting a local image asks for confirmation and moves its file to the Trash; an online image is only removed from the document. Zoom uses HTML's zoom property; HTML images also support width and height. Click an HTML image to edit its full tag while retaining the preview. Converting it back to Markdown removes size attributes.

Uploading requires your own image uploader configuration. PicGo/PicList desktop applications can use a local HTTP service. For command-line uploaders, Aropyt passes image paths as arguments to the configured command and reads HTTP addresses from its output.

## Recovery

Drafts are saved in the application's user data directory while you edit. Use Help → Document Recovery to choose a draft. Check the recovered content and save it.

## Themes

Choose a theme from the Themes menu. Choose Open Theme Folder to add your own CSS, then reopen the application. Themes control fonts, colors, and document layout; behavior is configured in Preferences.

## Word Count and Settings Search

The left side of the bottom bar contains the sidebar and source-mode buttons; the word count remains visible on the right. Move the pointer over the statistics area to reveal the A✓ spelling button and the statistics arrows. Click the count, or View → Toggle Word Count Popover, to open a titled panel listing reading time, lines, words, and characters. Click an entry to change the default unit. When text is selected, the bottom bar shows “selected / total”; the panel continues to show whole-document totals. Appearance preferences control the visibility of statistics and reading speed (1–999 words per minute, 382 by default, with 120 and 240 presets).

Word counts follow the reference application's character ranges and punctuation rules and include words in code, language names, links, and image paths. For example, “这是中文，测试。” counts as 7 words, and “한국어 텍스트” as 2. Characters are the UTF-16 length of the raw Markdown, including spaces, line breaks, and formatting markers. Lines equal the number of newline characters plus one; an empty document has 1 line. Reading time is rounded using the configured words per minute; a result of zero displays “≤ 1 minute”.

Search in Preferences finds setting content, opens the matching page, and highlights the matching setting groups. Press Escape to clear the search.

## Spell Check

Spell check is off by default, and offline dictionaries are not installed by default. Download dictionaries as needed in Preferences, or import local Hunspell `.aff` / `.dic` files. Downloaded and imported dictionaries work offline.

Click A✓ in the bottom bar to open the language menu. Choose automatic detection, disable checking, or select one of 36 language options (Chinese and Japanese use English dictionaries under the reference rules). The field at the top filters by language name or code. Use the arrow keys to move, Enter to select, and Escape to close. This choice applies to the current document. Global Settings at the bottom opens the default language and code/link checking preferences. Automatic detection uses plain text from at most the first four paragraphs or headings and falls back to the system language when the CLD2 result is unreliable. Chinese, Japanese, and Hindi use an English dictionary to check English words within the text.

Misspellings use wavy underlines. The context menu offers up to six Hunspell suggestions and lets you learn spelling or unlearn a previously learned word. User dictionaries are saved by language in `user-dict.json` in the configuration directory; older word lists migrate automatically. Code and links are skipped by default. Neither document text nor words are uploaded.

When the sidebar opens, the lower-left buttons move to the left edge of the editor. Show / Hide Sidebar uses a circle icon with a solid center dot on hover. Source mode shows a gray `</> Exit Source Code Mode` button in that position; clicking it restores the editing preview and both buttons.

## Interface Language

In Preferences → General → Language, choose Simplified Chinese, English, or the system language. The interface, menus, settings, built-in help, messages, and editing tools follow that choice. File names, paths, code, proper names, and existing document content retain their original text.

## Comparison with Typora

Aropyt is not yet identical to Typora. Current behavior, confirmed differences, unverified areas, and verification commands are maintained in [Feature Status and Typora Differences](typora-parity.md). See the [Privacy Notice](privacy.en.md) for privacy and network behavior, and [Third-Party Components](credits.en.md) for resource origins.
