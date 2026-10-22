import { resolveLang, type Lang } from '../main/menu-model';

let language: Lang = resolveLang(typeof navigator === 'undefined' ? 'en' : navigator.language, 'auto');

/** Interface language only; never translates document text or user paths. */
export function setUiLanguage(value: Lang): void { language = value; }
export function getUiLanguage(): Lang { return language; }
export function uiText(zh: string, en: string, lang: Lang = language): string {
  return lang === 'zh' ? zh : en;
}
