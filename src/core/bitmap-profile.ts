/** 将位图的有色笔迹按列取加权中心。白色/透明像素不参与，透明列切断曲线。 */
import type { Pt } from './geom';
export function bitmapProfile(rgba: ArrayLike<number>, width: number, height: number): Pt[][] {
  const paths: Pt[][] = []; let path: Pt[] = [];
  for (let x = 0; x < width; x++) {
    let sum = 0, weight = 0;
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      const w = (rgba[i + 3] / 255) * (1 - Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) / 255);
      if (w > 1 / 255) { sum += y * w; weight += w; }
    }
    if (weight) path.push({ x: width > 1 ? x / (width - 1) : 0.5, y: height > 1 ? sum / weight / (height - 1) : 0.5 });
    else if (path.length) { paths.push(path); path = []; }
  }
  if (path.length) paths.push(path);
  return paths;
}
