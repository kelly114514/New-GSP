import { bitmapProfile } from '../core/bitmap-profile';
/** 取样最多1024²像素，文档只保存归一化笔迹，不依赖异步画布求值。 */
export async function sampleBitmap(data: string, mime: string) {
  const img = new Image(); img.src = `data:${mime};base64,${data}`;
  await img.decode();
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return bitmapProfile(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
