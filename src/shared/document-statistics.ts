export type CountUnit = 'minutes' | 'lines' | 'words' | 'characters';
export interface DocumentStatistics { minutes: number; lines: number; words: number; characters: number }
export interface StatisticsState {
  total: DocumentStatistics;
  selected: DocumentStatistics | null;
  unit: CountUnit;
  lang: 'zh' | 'en';
  visible: boolean;
}
export const COUNT_UNITS: CountUnit[] = ['minutes', 'lines', 'words', 'characters'];
export function countUnit(value: unknown): CountUnit { return COUNT_UNITS.includes(value as CountUnit) ? value as CountUnit : 'words'; }

/** Preserve the reference's ranges and punctuation rules, including fullwidth
 * commas counting separately beside Chinese, and Hangul syllables staying words.
 * Count raw Markdown: code, fence languages, URLs and format markers remain. */
export function countWords(source: string): number {
  if (source.trim().length === 0) return 0;
  let wide = 0;
  const padded = 'd ' + source
    .replace(/[\u3040-\uABFF\uD7A4-\uFAFF]/gi, () => { wide++; return ' '; })
    .replace(/['’]\w+/g, 'b')
    .replace(/(^|\s+)[(\u3000-\u303F)!-\/:-@\[-`{-~]+(\s+|$)/gm, ' ') + ' d';
  return wide + padded.split(/[(\u3000-\u303F)\s!-,\\:-@\[-`{-~]+/g).length - 2;
}
export function readingMinutes(words: number, readingSpeed: unknown = 382): number {
  const speed = Number(readingSpeed);
  return Math.round(words / (Number.isFinite(speed) && speed > 0 ? speed : 382));
}
export function documentStatistics(source: string, readingSpeed: unknown = 382): DocumentStatistics {
  const words = countWords(source);
  return { words, characters: source.length, lines: source.split(/\n/g).length, minutes: readingMinutes(words, readingSpeed) };
}
export function statisticsLabel(value: DocumentStatistics, unit: CountUnit, lang: 'zh' | 'en'): string {
  const labels = lang === 'zh' ? { minutes: '分钟', lines: '行', words: '词', characters: '字符' }
    : { minutes: value.minutes <= 1 ? 'minute' : 'minutes', lines: value.lines === 1 ? 'line' : 'lines',
      words: value.words === 1 ? 'word' : 'words', characters: value.characters === 1 ? 'character' : 'characters' };
  return `${unit === 'minutes' && value.minutes === 0 ? '≤ 1' : value[unit]} ${labels[unit]}`;
}
export function statisticsSelectionLabel(state: StatisticsState): string {
  const total = statisticsLabel(state.total, state.unit, state.lang);
  if (!state.selected) return total;
  const selected = state.unit === 'minutes' && state.selected.minutes === 0 ? '≤ 1' : state.selected[state.unit];
  return `${selected} / ${total}`;
}
export function statisticsPanelHtml(state: StatisticsState): string {
  return `<div class="word-count-heading">${state.lang === 'zh' ? '字数统计' : 'Word count'}</div><div class="word-count-metrics">` + COUNT_UNITS.map((unit) => {
    const label = statisticsLabel(state.total, unit, state.lang), number = unit === 'minutes' && state.total.minutes === 0 ? '≤ 1' : String(state.total[unit]);
    const suffix = label.slice(number.length).trim();
    return `<button type="button" role="menuitemradio" aria-label="${label}" aria-checked="${state.unit === unit}" data-unit="${unit}"><span class="stat-value">${number}</span><span class="stat-unit">${suffix}</span></button>`;
  }).join('') + '</div>';
}
