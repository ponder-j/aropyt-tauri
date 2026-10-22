import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the production implementation, not a second copy of its regexes.
const result = await build({ entryPoints: ['src/shared/document-statistics.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { countWords, documentStatistics, statisticsLabel, statisticsSelectionLabel } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
const fixtures = [
  ['', 0], ['   \n  ', 0], ['Hello world', 2], ['Hello, world!', 2],
  ["don't stop", 2], ['你好世界', 4], ['Hello 你好', 3], ['这是中文，测试。', 7],
  ['这是中文测试。', 6], ['日本語のテキスト', 8], ['한국어 텍스트', 2],
  ['# Heading\n\none two three', 4], ['const x = 1;', 3],
];
for (const [source, words] of fixtures) {
  assert.equal(countWords(source), words, JSON.stringify(source));
  assert.deepEqual(documentStatistics(source), { words, characters: source.length, lines: source.split('\n').length, minutes: 0 });
}
assert.equal(countWords('a，b'), 1);
assert.equal(countWords('it’s fine'), 2);
assert.equal(documentStatistics('one\rtwo').lines, 1);
assert.equal(documentStatistics('one\r\ntwo\n').lines, 3);
assert.equal(documentStatistics('😀').characters, 2, 'Characters use UTF-16 source length');
assert.equal(documentStatistics('word '.repeat(190)).minutes, 0);
assert.equal(documentStatistics('word '.repeat(191)).minutes, 1);
assert.equal(documentStatistics('word '.repeat(200), 100).minutes, 2);
assert.equal(documentStatistics('word '.repeat(200), 0).minutes, 1);
assert.equal(statisticsLabel(documentStatistics(''), 'minutes', 'zh'), '≤ 1 分钟');
assert.equal(statisticsSelectionLabel({ total: documentStatistics('Hello 你好'), selected: documentStatistics('你好'), unit: 'words', lang: 'zh', visible: true }), '2 / 3 词');
console.log(`PASS ${fixtures.length} supplied word-count fixtures, fullwidth punctuation, contractions, source characters/lines, reading-time rounding and selected/total labels`);
