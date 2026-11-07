import type { FontSpec, TextRun } from './model';

export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && JSON.stringify(last.font) === JSON.stringify(run.font)) last.text += run.text;
    else out.push({ text: run.text, font: { ...run.font } });
  }
  return out;
}
export function fontAt(runs: TextRun[], pos: number, fallback: FontSpec): FontSpec {
  let offset = 0;
  for (const run of runs) { offset += run.text.length; if (pos < offset) return run.font; }
  return runs.at(-1)?.font ?? fallback;
}
export function styleRange(runs: TextRun[], start: number, end: number, apply: (font: FontSpec) => FontSpec): TextRun[] {
  let offset = 0; const out: TextRun[] = [];
  for (const run of runs) {
    const a = Math.max(0, Math.min(run.text.length, start - offset)), b = Math.max(a, Math.min(run.text.length, end - offset));
    out.push({ text: run.text.slice(0, a), font: run.font }, { text: run.text.slice(a, b), font: apply(run.font) }, { text: run.text.slice(b), font: run.font });
    offset += run.text.length;
  }
  return normalizeRuns(out);
}
/** 用最长相同前后缀保留未改动文字的样式，插入文字继承插入点样式。 */
export function replaceText(runs: TextRun[], next: string, fallback: FontSpec): TextRun[] {
  const old = runs.map(r => r.text).join(''); let a = 0, suffix = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  while (suffix < old.length - a && suffix < next.length - a && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const slice = (start: number, end: number) => { let n = 0; return runs.flatMap(r => { const s = r.text.slice(Math.max(0, start - n), Math.max(0, end - n)); n += r.text.length; return s ? [{ text: s, font: r.font }] : []; }); };
  return normalizeRuns([...slice(0, a), { text: next.slice(a, next.length - suffix), font: fontAt(runs, Math.max(0, a - 1), fallback) }, ...slice(old.length - suffix, old.length)]);
}
