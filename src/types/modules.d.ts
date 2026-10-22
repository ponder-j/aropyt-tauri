// Ambient declarations for third-party modules that ship without types.
declare module 'hjson' {
  const Hjson: {
    parse(text: string, options?: Record<string, unknown>): unknown;
    stringify(value: unknown, options?: Record<string, unknown>): string;
  };
  export default Hjson;
}

declare module 'markdown-it-footnote';
declare module 'markdown-it-task-lists';
declare module 'markdown-it-mark';
declare module 'markdown-it-sub';
declare module 'markdown-it-sup';
declare module 'jschardet' {
  export function detect(buffer: Buffer | string): { encoding: string | null; confidence: number };
}
