/** 将浏览器能打开的其它位图转换成 PNG，供高度函数离线重新求值。 */
export async function bitmapAsPng(data: string, mime: string) {
  const img = new Image(); img.src = `data:${mime};base64,${data}`;
  await img.decode();
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').split(',')[1];
}
