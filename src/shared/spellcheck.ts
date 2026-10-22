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
