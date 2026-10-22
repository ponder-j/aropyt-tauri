import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Use Node's URL escaping for drive letters, UNC shares, %, # and spaces. */
export function localFileUrl(source: string, document?: string | null, folder?: string | null, encoded = true): string {
  if (/^(https?:|data:|file:)/i.test(source)) return source;
  let decoded = source;
  if (encoded) try { decoded = decodeURIComponent(source); } catch { /* Literal percent in a filename. */ }
  const base = document ? path.dirname(document) : folder;
  if (!base && !path.isAbsolute(decoded)) return source;
  return pathToFileURL(path.resolve(base || '.', decoded)).href;
}

export function imageFileReference(target: string, document: string | null, relative: boolean, dotSlash: boolean, escape = true): string {
  if (!document || !relative) return pathToFileURL(target).href;
  let ref = path.relative(path.dirname(document), target);
  // Windows cannot express another drive or UNC share as a relative path.
  if (path.isAbsolute(ref)) return pathToFileURL(target).href;
  ref = ref.split(path.sep).join('/');
  if (dotSlash && !ref.startsWith('.')) ref = './' + ref;
  return escape ? ref.split('/').map(part => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/') : ref;
}
