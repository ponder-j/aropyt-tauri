import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensions = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdwn', '.mdtxt', '.mdtext', '.text', '.txt', '.rmd']);

/** A second instance's relative paths belong to its working directory. */
export function launchFiles(argv: string[], workingDirectory: string): string[] {
  return argv.slice(1).flatMap(arg => {
    if (arg.startsWith('-')) return [];
    try {
      // Linux desktop entries use %U and can pass file: URLs rather than paths.
      const file = /^file:/i.test(arg) ? fileURLToPath(arg) : path.resolve(workingDirectory, arg);
      return extensions.has(path.extname(file).toLowerCase()) && fs.statSync(file).isFile() ? [file] : [];
    } catch { return []; }
  });
}
