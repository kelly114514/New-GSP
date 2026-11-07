"""生成自行绘制的应用图标。"""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / 'src-tauri' / 'icons'
out.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (256, 256), '#f7f8fb')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 247, 247), radius=35, fill='#f7f8fb', outline='#31557f', width=8)
draw.ellipse((50, 50, 206, 206), outline='#31557f', width=9)
draw.line((52, 179, 128, 53, 204, 179, 52, 179), fill='#be4a4a', width=8, joint='curve')
for x, y in [(52, 179), (128, 53), (204, 179)]:
    draw.ellipse((x-9, y-9, x+9, y+9), fill='#be4a4a')
image.save(out / 'icon.png')
image.save(out / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(256,256)])
