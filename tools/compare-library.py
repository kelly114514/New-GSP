"""对照原版截图与新版渲染：相对各自背景的前景在 2 像素内互相覆盖的比例。
用法：python tools/compare-library.py 原版截图目录 新版渲染目录 输出.json [列表.txt]
得分 = min(原版墨迹被新版覆盖的比例, 新版墨迹被原版覆盖的比例)，越低差异越大。另给出彩色墨迹（饱和度高）的同样指标。
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation

orig, new, outp = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
items = Path(sys.argv[4]).read_text(encoding='utf-8').splitlines() if len(sys.argv) > 4 else None
K = np.ones((5, 5), bool)


def masks(path, size=None, reference_background=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != size: im = im.crop((0, 0, *size))
    a = np.asarray(im).astype(np.int16)
    # 取出现最多的实际颜色，避免彩色背景整幅都被计为前景。
    sampled = a[::4, ::4].reshape(-1, 3).astype(np.int32)
    packed = (sampled[:, 0] << 16) | (sampled[:, 1] << 8) | sampled[:, 2]
    colors, counts = np.unique(packed, return_counts=True)
    bg = int(colors[counts.argmax()])
    background = np.array([bg >> 16, (bg >> 8) & 255, bg & 255], dtype=np.int16)
    mn, mx = a.min(axis=2), a.max(axis=2)
    ink = np.max(np.abs(a - (background if reference_background is None else reference_background)), axis=2) > 60
    color = ink & ((mx - mn) > 60)
    return ink, color, background.tolist()


def cover(a, b):
    if not a.any(): return 1.0 if not b.any() else 0.0
    return float((a & binary_dilation(b, K)).sum() / a.sum())


res = {}
for p in sorted(orig.glob('[0-9][0-9][0-9][0-9].png')):
    q = new / p.name
    if not q.exists(): continue
    oi, oc, ob = masks(p)
    ni, nc, nb = masks(q, (oi.shape[1], oi.shape[0]), np.asarray(ob, dtype=np.int16))
    h, w = min(oi.shape[0], ni.shape[0]), min(oi.shape[1], ni.shape[1])
    oi, oc, ni, nc = oi[:h, :w], oc[:h, :w], ni[:h, :w], nc[:h, :w]
    r1, r2 = cover(oi, ni), cover(ni, oi)
    c1, c2 = cover(oc, nc), cover(nc, oc)
    res[p.stem] = {'src': items[int(p.stem)] if items else None, 'score': round(min(r1, r2), 4), 'origCovered': round(r1, 4), 'newCovered': round(r2, 4),
                   'colorScore': round(min(c1, c2), 4), 'origInk': int(oi.sum()), 'newInk': int(ni.sum()),
                   'origBackground': ob, 'newBackground': nb}
outp.write_text(json.dumps(res, ensure_ascii=False, indent=0), encoding='utf-8')
scores = sorted(v['score'] for v in res.values())
if scores:
    print('files', len(scores), 'mean', round(sum(scores) / len(scores), 4), '>=0.95', sum(s >= .95 for s in scores), '>=0.9', sum(s >= .9 for s in scores), '<0.7', sum(s < .7 for s in scores))
