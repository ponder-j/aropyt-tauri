# Offline spelling assets

The application uses the unmodified Hunspell WebAssembly build from the pinned
`hunspell-asm` npm dependency, plus the N-API CLD2 build from `cld`. The build copies
CLD2's local native binary into `dist/main/cld.node`; it does not depend on a system
dictionary or send document text to a service.

- Hunspell source and MPL license: <https://github.com/hunspell/hunspell>
- WASM build/bindings and build recipe: <https://github.com/kwonoj/hunspell-asm>
- CLD2 binding and source: <https://github.com/dachev/node-cld>
- UTF-8 dictionaries: <https://github.com/wooorm/dictionaries>
- Indonesian/Arabic dictionaries: `id/SOURCE.md` and `ar/SOURCE.md` record exact LibreOffice commits.
- Malay dictionary: `ms/SOURCE.md` records the Hunspell-MS commit and UTF-8 conversion.

`build.mjs` copies each dictionary's affix, word list and license into
`dist/spellcheck`. The language/package mapping is in `src/shared/spellcheck.ts`;
package-lock.json pins all npm inputs. Dictionary data retains its original license.

The supplied Typora analysis describes a private fork with 62,119 US English
roots. Aropyt uses the publicly distributed dictionaries listed above (49,568
roots in dictionary-en 4.0.0). Consequently not every verdict or suggestion order
is guaranteed identical to that private fork, even though both use Hunspell.
