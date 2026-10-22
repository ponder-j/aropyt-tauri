import { inlineMathSpans, inlineSpans, nativeParagraph } from './inline-markdown';
import { tableText } from './table-dom';

const projections = new WeakMap<HTMLElement, string>();
/** Keep Markdown in text nodes (including hidden delimiters), so DOM ranges
 * map to the same source offsets before and after a format is opened. */
export function projectTableInline(cell: HTMLElement, source: string, selection: [number, number] | null, math?: (tex: string) => string): boolean | null {
  if (!nativeParagraph(source)) { projections.delete(cell); return null; }
  const formulas = inlineMathSpans(source);
  const spans = [...inlineSpans(source).filter((span) => !formulas.some((formula) => span.from >= formula.from && span.to <= formula.to)),
    ...formulas.map((formula) => ({ ...formula, bodyFrom: formula.from + 1, bodyTo: formula.to - 1, className: 'cm-md-math-source', href: undefined }))];
  const active = spans.map((span) => !!selection && (selection[0] === selection[1]
    ? selection[0] > span.from && selection[0] < span.to : selection[0] < span.to && selection[1] > span.from));
  const key = source + '\0' + JSON.stringify(spans.map((span, i) => [span, active[i]]));
  if (projections.get(cell) === key && tableText(cell) === source && (!spans.length || cell.querySelector('[data-table-inline]'))) return false;
  projections.set(cell, key);
  if (!spans.length) { cell.textContent = source; return true; }
  const points = [...new Set([0, source.length, ...spans.flatMap((span) => [span.from, span.bodyFrom, span.bodyTo, span.to])])].sort((a, b) => a - b);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1]; if (from === to) continue;
    const part = document.createElement('span'); part.dataset.tableInline = ''; part.textContent = source.slice(from, to);
    const classes = new Set<string>(); let hidden = false;
    spans.forEach((span, index) => {
      if (formulas.some((formula) => formula.from === span.from && formula.to === span.to) && !active[index] && from >= span.from && to <= span.to) { hidden = true; return; }
      const marker = from >= span.from && to <= span.bodyFrom || from >= span.bodyTo && to <= span.to;
      if (marker) { if (active[index]) classes.add('cm-md-marker'); else hidden = true; }
      else if (from >= span.bodyFrom && to <= span.bodyTo && span.className) {
        classes.add(span.className);
        if (span.href) { part.dataset.href = span.href; part.title = span.href; }
      }
    });
    if (hidden) { classes.add('md-table-hidden-marker'); part.setAttribute('aria-hidden', 'true'); }
    part.className = [...classes].join(' '); fragment.append(part);
    const formula = formulas.find((formula) => formula.to === to);
    if (formula && !active[spans.findIndex((span) => span.from === formula.from && span.to === formula.to)]) {
      const preview = document.createElement('span'); preview.className = 'md-table-math-preview'; preview.contentEditable = 'false';
      preview.dataset.tableRendered = ''; preview.dataset.tex = formula.tex; preview.dataset.from = String(formula.from); preview.dataset.to = String(formula.to);
      preview.innerHTML = math?.(formula.tex) || formula.tex; fragment.append(preview);
    }
  }
  cell.replaceChildren(fragment); return true;
}
