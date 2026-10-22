import './polyfills';
import { convertFileSrc } from '@tauri-apps/api/core';
export function filePath(source: string): string {
  if (/^(asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/i.test(source)) {
    const raw = source.replace(/^(asset:\/\/localhost\/|https?:\/\/asset\.localhost\/)/i, '');
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  if (/^file:/i.test(source)) {
    const url = new URL(source); let p = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:/i.test(p)) p = p.slice(1);
    return url.hostname ? '\\\\' + url.hostname + p.replace(/\//g, '\\') : p;
  }
  return source;
}
export function asFileUrl(p: string): string {
  p = filePath(p).replace(/\\/g, '/');
  if (p.startsWith('//')) { const parts=p.slice(2).split('/'); const url=new URL('file://'+parts.shift()+'/'); url.pathname='/'+parts.join('/'); return url.href; }
  if (/^[a-z]:/i.test(p)) p = '/' + p;
  const url = new URL('file:///'); url.pathname = p; return url.href;
}
export function localFileUrl(source: string, document?: string | null, folder?: string | null, encoded = true): string {
  if (/^(asset:|https?:\/\/asset\.localhost\/)/i.test(source)) return asFileUrl(filePath(source));
  if (/^(https?:|data:|file:)/i.test(source)) return source;
  let decoded = source;
  if (encoded) try { decoded = decodeURIComponent(source); } catch { /* literal percent */ }
  const base = document ? filePath(document).replace(/[\\/][^\\/]*$/, '') : folder;
  if (!base && !/^(\/|[a-z]:|\\\\)/i.test(decoded)) return source;
  const absolute = /^(\/|[a-z]:|\\\\)/i.test(decoded) ? decoded : base + '/' + decoded;
  return new URL(asFileUrl(absolute)).href;
}
export function displayFileUrl(source: string): string {
  return (window as any).__TAURI_INTERNALS__ && /^file:/i.test(source) ? convertFileSrc(filePath(source)) : source;
}
