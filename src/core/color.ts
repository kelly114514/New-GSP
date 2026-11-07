/** 参数颜色变换：分量归一化、灰度、RGB、HSV 和单参数光谱。 */
import type { Def } from './model';
type Coloring = Extract<Def, { k: 'colorize' }>;
export function parameterColor(d: Coloring, values: number[]): string | undefined {
  if (!values.every(Number.isFinite) || d.to === d.from) return undefined;
  const normalize = (v: number) => {
    const t = (v - d.from) / (d.to - d.from);
    if (d.cycle === 'none') return Math.max(0, Math.min(1, t));
    if (d.cycle === 'one') return t - Math.floor(t);
    const p = ((t % 2) + 2) % 2; return p <= 1 ? p : 2 - p;
  };
  const v = values.map(normalize);
  let rgb: number[];
  if (d.mode === 'gray') rgb = [v[0], v[0], v[0]];
  else if (d.mode === 'rgb') rgb = v;
  else if (d.mode === 'hsv') {
    const h = (v[0] % 1) * 6, c = v[1] * v[2], x = c * (1 - Math.abs(h % 2 - 1)), m = v[2] - c;
    rgb = (h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]).map(n => n + m);
  } else {
    const w = 3850 + 2900 * v[0], rise = (n: number) => 1 - n * n;
    rgb = w < 4400 ? [(4400 - w) / 600, 0, 1]
      : w < 5100 ? [0, rise((5100 - w) / 700), rise((w - 4400) / 700)]
      : w < 6450 ? [rise((6450 - w) / 1350), rise((w - 5100) / 1350), 0] : [1, 0, 0];
  }
  return `#${rgb.map(n => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0')).join('')}`;
}
