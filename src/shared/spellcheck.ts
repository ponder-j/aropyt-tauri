import type { Lang } from '../main/menu-model';

export const SPELL_LANGUAGES = [
  ['en-US', 'English (US)', 'en'], ['en-GB', 'English (UK)', 'en-gb'],
  ['id', 'Bahasa Indonesia', 'vendor:id'], ['nb', 'Bokmål', 'nb'], ['cs', 'Čeština', 'cs'],
  ['ca', 'Català', 'ca'], ['da', 'Dansk', 'da'], ['de', 'Deutsch', 'de'],
  ['de-CH', 'Schweizerdeutsch', 'de-ch'], ['es', 'Español', 'es'], ['el', 'Ελληνικά', 'el'],
  ['fr', 'Français', 'fr'], ['gl', 'Galego', 'gl'], ['hr', 'Hrvatski', 'hr'], ['it', 'Italiano', 'it'],
  ['ro', 'Limba Română', 'ro'], ['nl', 'Nederlands', 'nl'], ['nn', 'Nynorsk', 'nn'], ['hu', 'Magyar', 'hu'],
  ['ms', 'Orang Melayu', 'vendor:ms'], ['pl', 'Polski', 'pl'], ['pt-BR', 'Português (Brasil)', 'pt'],
  ['pt', 'Português (Portugal)', 'pt-pt'], ['ru', 'Ру́сский', 'ru'],
  ['sk', 'Slovenčina', 'sk'], ['sl', 'Slovenščina', 'sl'], ['sv', 'Svenska', 'sv'],
  ['vi', 'Tiếng Việt', 'vi'], ['tr', 'Türkçe', 'tr'], ['uk', 'Українська мова', 'uk'],
  ['fa', 'فارسی', 'fa'], ['ar', 'العربية', 'vendor:ar'], ['he', 'עִבְרִית', 'he'], ['ko', '한국어', 'ko'],
  ['zh', '中文', 'en'], ['ja', '日本語', 'en'],
] as const;
const SPELL_LANGUAGE_NAMES: Record<string, readonly [string, string]> = {
  'en-US': ['英语（美国）', 'English (US)'], 'en-GB': ['英语（英国）', 'English (UK)'],
  id: ['印度尼西亚语', 'Indonesian'], nb: ['挪威书面语', 'Norwegian Bokmål'], cs: ['捷克语', 'Czech'],
  ca: ['加泰罗尼亚语', 'Catalan'], da: ['丹麦语', 'Danish'], de: ['德语', 'German'],
  'de-CH': ['德语（瑞士）', 'German (Switzerland)'], es: ['西班牙语', 'Spanish'], el: ['希腊语', 'Greek'],
  fr: ['法语', 'French'], gl: ['加利西亚语', 'Galician'], hr: ['克罗地亚语', 'Croatian'], it: ['意大利语', 'Italian'],
  ro: ['罗马尼亚语', 'Romanian'], nl: ['荷兰语', 'Dutch'], nn: ['新挪威语', 'Norwegian Nynorsk'], hu: ['匈牙利语', 'Hungarian'],
  ms: ['马来语', 'Malay'], pl: ['波兰语', 'Polish'], 'pt-BR': ['葡萄牙语（巴西）', 'Portuguese (Brazil)'],
  pt: ['葡萄牙语（葡萄牙）', 'Portuguese (Portugal)'], ru: ['俄语', 'Russian'],
  sk: ['斯洛伐克语', 'Slovak'], sl: ['斯洛文尼亚语', 'Slovenian'], sv: ['瑞典语', 'Swedish'],
  vi: ['越南语', 'Vietnamese'], tr: ['土耳其语', 'Turkish'], uk: ['乌克兰语', 'Ukrainian'],
  fa: ['波斯语', 'Persian'], ar: ['阿拉伯语', 'Arabic'], he: ['希伯来语', 'Hebrew'], ko: ['韩语', 'Korean'],
  zh: ['中文', 'Chinese'], ja: ['日语', 'Japanese'],
};
/** Dictionary language names follow the interface language, never the dictionary's autonym. */
export function spellLanguageName(code: string, lang: Lang): string {
  return SPELL_LANGUAGE_NAMES[code]?.[lang === 'zh' ? 0 : 1] ?? code;
}
export type SpellMode = 'auto' | 'off' | string;
export interface SpellState { mode: SpellMode; language: string; enabled: boolean; revision?: number }
export function normalizeSpellWord(word: string): string { return word.normalize().replace(/’/g, "'"); }
export function spellMode(value: unknown): SpellMode {
  return value === 'off' || value === 'auto' || SPELL_LANGUAGES.some(([code]) => code === value) ? String(value) : 'auto';
}
export function dictionaryLanguage(value: string): string {
  const lang = value.replace('_', '-');
  if (/^(zh|ja|hi)(-|$)/i.test(lang)) return 'en-US';
  if (/^pt-PT$/i.test(lang)) return 'pt';
  return SPELL_LANGUAGES.find(([code]) => code.toLowerCase() === lang.toLowerCase())?.[0]
    || SPELL_LANGUAGES.find(([code]) => code.split('-')[0] === lang.split('-')[0])?.[0] || 'en-US';
}
export interface WordChecker { isMisspelled(word: string): boolean }
/** Keep original words in the result: Blink uses these to locate underlines. */
export function checkSpellBatch(words: readonly string[], checker: WordChecker): string[] {
  if (words.length > 1000) return [];
  const bad: string[] = [];
  for (const word of words.slice(0, 200)) {
    const normalized = normalizeSpellWord(word);
    let miss = checker.isMisspelled(normalized);
    if (miss && normalized.indexOf('.') > 0) miss = checker.isMisspelled(normalized + '.');
    if (miss) bad.push(word);
    if (bad.length >= 30) break;
  }
  return bad;
}
