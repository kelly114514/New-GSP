#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""emf_dump.py - 纯标准库的 EMF / EMF+ 解析器，用于几何画板 oracle 的 EMF 对照。

用法:
    python tools/emf_dump.py file.emf                 # 头信息 + 每条记录 + 图元摘要
    python tools/emf_dump.py file.emf --primitives    # 只打印图元摘要
    python tools/emf_dump.py file.emf --json out.json # 完整结构化输出（头、记录、图元、未知记录）
    python tools/emf_dump.py file.emf --layer gdi     # 图元来源: gdi | emfplus | auto(默认)

作为库使用:
    sys.path.insert(0, "tools"); import emf_dump
    r = emf_dump.parse_emf(open(p, "rb").read())
    r["header"], r["records"], r["primitives"], r["primitives_gdi"], r["primitives_emfplus"],
    r["unknown_records"], r["validation"]

约定:
  * "log"  = 记录里的逻辑坐标原值(GDI 为 32/16 位整数, EMF+ 为浮点)。
  * "dev"  = 经世界变换(MODIFYWORLDTRANSFORM 等) + 映射模式 之后的设备坐标。
  * "px96" = dev 按参考设备 dpi 换算到 96 dpi 屏幕像素 (dev * 96 / dpi)。
  几何画板写出的 EMF 是 EMF+ 双格式(dual): 同一图形既有 EMF+ 记录(浮点, 600dpi 像素)又有
  GDI 回退记录(整数, 经 1/16 缩放世界变换)。默认优先使用 EMF+ 图元。
"""
import argparse
import json
import math
import struct
import sys

# --------------------------------------------------------------------------- 常量

RECORD_NAMES = {
    1: "HEADER", 2: "POLYBEZIER", 3: "POLYGON", 4: "POLYLINE", 5: "POLYBEZIERTO",
    6: "POLYLINETO", 7: "POLYPOLYLINE", 8: "POLYPOLYGON", 9: "SETWINDOWEXTEX",
    10: "SETWINDOWORGEX", 11: "SETVIEWPORTEXTEX", 12: "SETVIEWPORTORGEX",
    13: "SETBRUSHORGEX", 14: "EOF", 15: "SETPIXELV", 16: "SETMAPPERFLAGS",
    17: "SETMAPMODE", 18: "SETBKMODE", 19: "SETPOLYFILLMODE", 20: "SETROP2",
    21: "SETSTRETCHBLTMODE", 22: "SETTEXTALIGN", 23: "SETCOLORADJUSTMENT",
    24: "SETTEXTCOLOR", 25: "SETBKCOLOR", 26: "OFFSETCLIPRGN", 27: "MOVETOEX",
    28: "SETMETARGN", 29: "EXCLUDECLIPRECT", 30: "INTERSECTCLIPRECT",
    31: "SCALEVIEWPORTEXTEX", 32: "SCALEWINDOWEXTEX", 33: "SAVEDC", 34: "RESTOREDC",
    35: "SETWORLDTRANSFORM", 36: "MODIFYWORLDTRANSFORM", 37: "SELECTOBJECT",
    38: "CREATEPEN", 39: "CREATEBRUSHINDIRECT", 40: "DELETEOBJECT", 41: "ANGLEARC",
    42: "ELLIPSE", 43: "RECTANGLE", 44: "ROUNDRECT", 45: "ARC", 46: "CHORD",
    47: "PIE", 48: "SELECTPALETTE", 49: "CREATEPALETTE", 50: "SETPALETTEENTRIES",
    51: "RESIZEPALETTE", 52: "REALIZEPALETTE", 53: "EXTFLOODFILL", 54: "LINETO",
    55: "ARCTO", 56: "POLYDRAW", 57: "SETARCDIRECTION", 58: "SETMITERLIMIT",
    59: "BEGINPATH", 60: "ENDPATH", 61: "CLOSEFIGURE", 62: "FILLPATH",
    63: "STROKEANDFILLPATH", 64: "STROKEPATH", 65: "FLATTENPATH", 66: "WIDENPATH",
    67: "SELECTCLIPPATH", 68: "ABORTPATH", 70: "COMMENT", 71: "FILLRGN",
    72: "FRAMERGN", 73: "INVERTRGN", 74: "PAINTRGN", 75: "EXTSELECTCLIPRGN",
    76: "BITBLT", 77: "STRETCHBLT", 78: "MASKBLT", 79: "PLGBLT",
    80: "SETDIBITSTODEVICE", 81: "STRETCHDIBITS", 82: "EXTCREATEFONTINDIRECTW",
    83: "EXTTEXTOUTA", 84: "EXTTEXTOUTW", 85: "POLYBEZIER16", 86: "POLYGON16",
    87: "POLYLINE16", 88: "POLYBEZIERTO16", 89: "POLYLINETO16", 90: "POLYPOLYLINE16",
    91: "POLYPOLYGON16", 92: "POLYDRAW16", 93: "CREATEMONOBRUSH",
    94: "CREATEDIBPATTERNBRUSHPT", 95: "EXTCREATEPEN", 96: "POLYTEXTOUTA",
    97: "POLYTEXTOUTW", 98: "SETICMMODE", 99: "CREATECOLORSPACE", 100: "SETCOLORSPACE",
    101: "DELETECOLORSPACE", 102: "GLSRECORD", 103: "GLSBOUNDEDRECORD",
    104: "PIXELFORMAT", 105: "DRAWESCAPE", 106: "EXTESCAPE", 108: "SMALLTEXTOUT",
    109: "FORCEUFIMAPPING", 110: "NAMEDESCAPE", 111: "COLORCORRECTPALETTE",
    112: "SETICMPROFILEA", 113: "SETICMPROFILEW", 114: "ALPHABLEND", 115: "SETLAYOUT",
    116: "TRANSPARENTBLT", 118: "GRADIENTFILL", 119: "SETLINKEDUFIS",
    120: "SETTEXTJUSTIFICATION", 121: "COLORMATCHTOTARGETW", 122: "CREATECOLORSPACEW",
}

MAP_MODES = {1: "TEXT", 2: "LOMETRIC", 3: "HIMETRIC", 4: "LOENGLISH", 5: "HIENGLISH",
             6: "TWIPS", 7: "ISOTROPIC", 8: "ANISOTROPIC"}
MWT_MODES = {1: "IDENTITY", 2: "LEFTMULTIPLY", 3: "RIGHTMULTIPLY", 4: "SET"}
PEN_STYLES = {0: "SOLID", 1: "DASH", 2: "DOT", 3: "DASHDOT", 4: "DASHDOTDOT", 5: "NULL",
              6: "INSIDEFRAME", 7: "USERSTYLE", 8: "ALTERNATE"}
BRUSH_STYLES = {0: "SOLID", 1: "NULL", 2: "HATCHED", 3: "PATTERN", 4: "INDEXED",
                5: "DIBPATTERN", 6: "DIBPATTERNPT", 7: "PATTERN8X8", 8: "DIBPATTERN8X8",
                9: "MONOPATTERN"}
STOCK = {0: ("brush", "WHITE_BRUSH", "#ffffff"), 1: ("brush", "LTGRAY_BRUSH", "#c0c0c0"),
         2: ("brush", "GRAY_BRUSH", "#808080"), 3: ("brush", "DKGRAY_BRUSH", "#404040"),
         4: ("brush", "BLACK_BRUSH", "#000000"), 5: ("brush", "NULL_BRUSH", None),
         6: ("pen", "WHITE_PEN", "#ffffff"), 7: ("pen", "BLACK_PEN", "#000000"),
         8: ("pen", "NULL_PEN", None), 10: ("font", "OEM_FIXED_FONT", None),
         11: ("font", "ANSI_FIXED_FONT", None), 12: ("font", "ANSI_VAR_FONT", None),
         13: ("font", "SYSTEM_FONT", None), 14: ("font", "DEVICE_DEFAULT_FONT", None),
         15: ("palette", "DEFAULT_PALETTE", None), 16: ("font", "SYSTEM_FIXED_FONT", None),
         17: ("font", "DEFAULT_GUI_FONT", None), 18: ("brush", "DC_BRUSH", "#ffffff"),
         19: ("pen", "DC_PEN", "#000000")}

EMFPLUS_NAMES = {
    0x4001: "Header", 0x4002: "EndOfFile", 0x4003: "Comment", 0x4004: "GetDC",
    0x4005: "MultiFormatStart", 0x4006: "MultiFormatSection", 0x4007: "MultiFormatEnd",
    0x4008: "Object", 0x4009: "Clear", 0x400A: "FillRects", 0x400B: "DrawRects",
    0x400C: "FillPolygon", 0x400D: "DrawLines", 0x400E: "FillEllipse",
    0x400F: "DrawEllipse", 0x4010: "FillPie", 0x4011: "DrawPie", 0x4012: "DrawArc",
    0x4013: "FillRegion", 0x4014: "FillPath", 0x4015: "DrawPath",
    0x4016: "FillClosedCurve", 0x4017: "DrawClosedCurve", 0x4018: "DrawCurve",
    0x4019: "DrawBeziers", 0x401A: "DrawImage", 0x401B: "DrawImagePoints",
    0x401C: "DrawString", 0x401D: "SetRenderingOrigin", 0x401E: "SetAntiAliasMode",
    0x401F: "SetTextRenderingHint", 0x4020: "SetTextContrast",
    0x4021: "SetInterpolationMode", 0x4022: "SetPixelOffsetMode",
    0x4023: "SetCompositingMode", 0x4024: "SetCompositingQuality", 0x4025: "Save",
    0x4026: "Restore", 0x4027: "BeginContainer", 0x4028: "BeginContainerNoParams",
    0x4029: "EndContainer", 0x402A: "SetWorldTransform", 0x402B: "ResetWorldTransform",
    0x402C: "MultiplyWorldTransform", 0x402D: "TranslateWorldTransform",
    0x402E: "ScaleWorldTransform", 0x402F: "RotateWorldTransform",
    0x4030: "SetPageTransform", 0x4031: "ResetClip", 0x4032: "SetClipRect",
    0x4033: "SetClipPath", 0x4034: "SetClipRegion", 0x4035: "OffsetClip",
    0x4036: "DrawDriverString", 0x4037: "StrokeFillPath", 0x4038: "SerializableObject",
    0x4039: "SetTSGraphics", 0x403A: "SetTSClip",
}
EMFPLUS_OBJ_TYPES = {1: "Brush", 2: "Pen", 3: "Path", 4: "Region", 5: "Image", 6: "Font",
                     7: "StringFormat", 8: "ImageAttributes", 9: "CustomLineCap"}
EMFPLUS_UNITS = {0: "World", 1: "Display", 2: "Pixel", 3: "Point", 4: "Inch",
                 5: "Document", 6: "Millimeter"}

# 绘图记录: 出现这些类型的 EMF 才算"有图形内容"
DRAW_RECORD_TYPES = {2, 3, 4, 5, 6, 7, 8, 15, 41, 42, 43, 44, 45, 46, 47, 54, 55, 56, 62, 63, 64,
                     71, 72, 73, 74, 76, 77, 78, 79, 80, 81, 83, 84, 85, 86, 87, 88, 89, 90, 91,
                     92, 96, 97, 108, 114, 116, 118}


# --------------------------------------------------------------------------- 小工具

def colorref(c):
    return "#%02x%02x%02x" % (c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF)


def argb(c):
    """EMF+ ARGB(u32 0xAARRGGBB) -> '#rrggbb' 加 alpha 字段。"""
    return "#%02x%02x%02x" % ((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF), (c >> 24) & 0xFF


def hexpreview(b, n=24):
    s = b[:n].hex()
    return s + ("..." if len(b) > n else "")


def utf16(b):
    try:
        return b.decode("utf-16-le", errors="replace")
    except Exception:
        return ""


def rnd(v, n=4):
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(v, n)
    return v


def rndlist(pts, n=4):
    return [[rnd(a, n), rnd(b, n)] for a, b in pts]


IDENTITY = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mat_mul(a, b):
    """先应用 a 再应用 b (GDI 行向量约定: p' = p * M)。矩阵 = (m11,m12,m21,m22,dx,dy)。"""
    return (a[0] * b[0] + a[1] * b[2],
            a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2],
            a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4],
            a[4] * b[1] + a[5] * b[3] + b[5])


def mat_apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


# --------------------------------------------------------------------------- GDI 状态

class DC:
    def __init__(self):
        self.pen = {"kind": "pen", "stock": "BLACK_PEN", "style": "SOLID", "width": 1, "color": "#000000"}
        self.brush = {"kind": "brush", "stock": "WHITE_BRUSH", "style": "SOLID", "color": "#ffffff"}
        self.font = None
        self.textcolor = "#000000"
        self.bkcolor = "#ffffff"
        self.bkmode = None
        self.mapmode = 1
        self.win_org = (0, 0)
        self.win_ext = (1, 1)
        self.vp_org = (0, 0)
        self.vp_ext = (1, 1)
        self.xform = IDENTITY
        self.pos = (0, 0)
        self.textalign = 0
        self.polyfill = None
        self.rop2 = None
        self.arcdir = 1
        self.clip = []

    def copy(self):
        d = DC.__new__(DC)
        d.__dict__.update(self.__dict__)
        d.clip = list(self.clip)
        return d


class GdiInterp:
    """逐条记录解释 GDI 记录: 维护 DC/对象表, 产出图元。"""

    def __init__(self, header):
        self.hdr = header
        self.dc = DC()
        self.stack = []
        self.objects = {}
        self.prims = []
        self.in_path = False
        self.path = []
        self.live = True      # EMF+ 双格式文件里: 只有紧跟在 EMF+ GetDC 之后的 GDI 记录才是真正绘制, 其余是 EMF+ 的镜像副本
        self.sink = None      # 合并图元列表 (EMF+ 图元 + live 的 GDI 图元, 保持记录顺序)
        self.dpi = header.get("dpi") or 96.0
        dev = header.get("device") or [0, 0]
        mm = header.get("millimeters") or [0, 0]
        self.px_per_mm = (dev[0] / mm[0]) if (mm and mm[0]) else self.dpi / 25.4

    # ---- 坐标变换
    def to_dev(self, x, y):
        wx, wy = mat_apply(self.dc.xform, x, y)
        mm = self.dc.mapmode
        if mm == 1:
            return (wx, wy)
        if mm in (7, 8):
            we, ve = self.dc.win_ext, self.dc.vp_ext
            sx = ve[0] / we[0] if we[0] else 1.0
            sy = ve[1] / we[1] if we[1] else 1.0
            return ((wx - self.dc.win_org[0]) * sx + self.dc.vp_org[0],
                    (wy - self.dc.win_org[1]) * sy + self.dc.vp_org[1])
        unit_mm = {2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440.0}.get(mm, 1.0)
        s = unit_mm * self.px_per_mm
        return ((wx - self.dc.win_org[0]) * s + self.dc.vp_org[0],
                -(wy - self.dc.win_org[1]) * s + self.dc.vp_org[1])

    def px96(self, p):
        k = 96.0 / self.dpi
        return (p[0] * k, p[1] * k)

    def emit(self, kind, pts, **extra):
        if self.in_path:
            self.path.append({"op": kind, "log": [list(p) for p in pts], **{k: v for k, v in extra.items()
                                                                           if k in ("closed",)}})
            return
        dev = [self.to_dev(x, y) for x, y in pts]
        pr = {"layer": "gdi", "kind": kind,
              "log": [list(p) for p in pts],
              "dev": rndlist(dev),
              "px96": rndlist([self.px96(d) for d in dev])}
        pr.update(extra)
        if kind in ("polyline", "line", "bezier", "arc", "path_stroke", "ellipse", "rect", "roundrect",
                    "polygon", "chord", "pie", "polypolyline", "polypolygon", "polydraw"):
            pr["pen"] = pen_desc(self.dc.pen)
            w = pr["pen"].get("width")
            if isinstance(w, (int, float)) and pr["pen"].get("style") != "NULL":
                a, b = self.to_dev(0, 0), self.to_dev(1, 0)
                pr["pen"]["width_px96"] = rnd(w * math.hypot(b[0] - a[0], b[1] - a[1]) * 96.0 / self.dpi, 4)
        if kind in ("polygon", "ellipse", "rect", "roundrect", "chord", "pie", "polypolygon"):
            pr["brush"] = brush_desc(self.dc.brush)
        if self.dc.clip:
            pr["clip"] = list(self.dc.clip)
        if not self.live:
            pr["mirror"] = True
        elif self.sink is not None:
            self.sink.append(pr)
        self.prims.append(pr)

    def sel(self, ih):
        if ih & 0x80000000:
            kind, name, col = STOCK.get(ih & 0x7FFFFFFF, ("?", "STOCK_%d" % (ih & 0x7FFFFFFF), None))
            if kind == "pen":
                self.dc.pen = {"kind": "pen", "stock": name, "style": "NULL" if col is None else "SOLID",
                               "width": 1, "color": col}
            elif kind == "brush":
                self.dc.brush = {"kind": "brush", "stock": name, "style": "NULL" if col is None else "SOLID",
                                 "color": col}
            elif kind == "font":
                self.dc.font = {"kind": "font", "stock": name}
            return
        o = self.objects.get(ih)
        if not o:
            return
        if o["kind"] == "pen":
            self.dc.pen = o
        elif o["kind"] == "brush":
            self.dc.brush = o
        elif o["kind"] == "font":
            self.dc.font = o


def pen_desc(p):
    d = {"style": p.get("style"), "width": p.get("width"), "color": p.get("color")}
    if "style_raw" in p:
        d["style_raw"] = p["style_raw"]
    if p.get("stock"):
        d["stock"] = p["stock"]
    return d


def brush_desc(b):
    d = {"style": b.get("style"), "color": b.get("color")}
    if b.get("stock"):
        d["stock"] = b["stock"]
    return d


def pen_style_name(s):
    base = PEN_STYLES.get(s & 0xF, "STYLE_%d" % (s & 0xF))
    extra = []
    if s & 0x10000:
        extra.append("GEOMETRIC")
    cap = s & 0xF00
    if cap == 0x100:
        extra.append("CAP_SQUARE")
    elif cap == 0x200:
        extra.append("CAP_FLAT")
    join = s & 0xF000
    if join == 0x1000:
        extra.append("JOIN_BEVEL")
    elif join == 0x2000:
        extra.append("JOIN_MITER")
    return base + ("|" + "|".join(extra) if extra else "")


# --------------------------------------------------------------------------- GDI 记录解码

def rd_rect(b, o=0):
    return list(struct.unpack_from("<4i", b, o))


def decode_gdi(rt, p, gi, rec_off, data):
    """解码一条 GDI 记录(不含 8 字节头)。返回字段 dict; 同时驱动解释器产出图元。
    p: 记录负载(不含 type/size), rec_off: 记录起始偏移(处理 offString 等相对记录头的偏移时需要)。"""
    dc = gi.dc
    f = {}
    U = struct.unpack_from
    n = len(p)
    if rt in (2, 3, 4, 5, 6):  # 32 位点
        bounds = rd_rect(p, 0)
        cnt, = U("<I", p, 16)
        pts = [list(U("<ii", p, 20 + 8 * i)) for i in range(cnt)]
        f.update(bounds=bounds, count=cnt, points=pts)
        _poly(gi, rt, pts)
    elif rt in (85, 86, 87, 88, 89):  # 16 位点
        bounds = rd_rect(p, 0)
        cnt, = U("<I", p, 16)
        pts = [list(U("<hh", p, 20 + 4 * i)) for i in range(cnt)]
        f.update(bounds=bounds, count=cnt, points=pts)
        _poly(gi, rt, pts)
    elif rt in (7, 8, 90, 91):
        bounds = rd_rect(p, 0)
        npoly, cpts = U("<II", p, 16)
        counts = list(U("<%dI" % npoly, p, 24))
        o = 24 + 4 * npoly
        wide = rt in (7, 8)
        step = 8 if wide else 4
        fmt = "<ii" if wide else "<hh"
        polys, k = [], 0
        for c in counts:
            polys.append([list(U(fmt, p, o + step * (k + i))) for i in range(c)])
            k += c
        f.update(bounds=bounds, polys=len(counts), counts=counts, total_points=cpts)
        f["points"] = [pt for poly in polys for pt in poly]
        kind = "polypolyline" if rt in (7, 90) else "polypolygon"
        flat = f["points"]
        gi.emit(kind, flat, counts=counts)
    elif rt in (56, 92):  # POLYDRAW
        bounds = rd_rect(p, 0)
        cnt, = U("<I", p, 16)
        wide = rt == 56
        step = 8 if wide else 4
        fmt = "<ii" if wide else "<hh"
        pts = [list(U(fmt, p, 20 + step * i)) for i in range(cnt)]
        types = list(p[20 + step * cnt:20 + step * cnt + cnt])
        f.update(bounds=bounds, count=cnt, points=pts, point_types=types)
        gi.emit("polydraw", pts, point_types=types)
    elif rt == 9:
        f["ext"] = list(U("<ii", p, 0)); dc.win_ext = tuple(f["ext"])
    elif rt == 10:
        f["org"] = list(U("<ii", p, 0)); dc.win_org = tuple(f["org"])
    elif rt == 11:
        f["ext"] = list(U("<ii", p, 0)); dc.vp_ext = tuple(f["ext"])
    elif rt == 12:
        f["org"] = list(U("<ii", p, 0)); dc.vp_org = tuple(f["org"])
    elif rt == 13:
        f["org"] = list(U("<ii", p, 0))
    elif rt == 14:
        f["nPalEntries"], f["offPalEntries"], f["nSizeLast"] = U("<III", p, 0)
    elif rt == 15:
        x, y, c = U("<iiI", p, 0)
        f.update(pt=[x, y], color=colorref(c))
        gi.emit("pixel", [(x, y)], color=colorref(c))
    elif rt == 17:
        v, = U("<I", p, 0); f["mode"] = v; f["name"] = MAP_MODES.get(v, str(v)); dc.mapmode = v
    elif rt == 18:
        v, = U("<I", p, 0); f["mode"] = {1: "TRANSPARENT", 2: "OPAQUE"}.get(v, v); dc.bkmode = v
    elif rt == 19:
        v, = U("<I", p, 0); f["mode"] = {1: "ALTERNATE", 2: "WINDING"}.get(v, v); dc.polyfill = v
    elif rt == 20:
        v, = U("<I", p, 0); f["rop2"] = v; dc.rop2 = v
    elif rt == 21:
        v, = U("<I", p, 0); f["mode"] = v
    elif rt == 22:
        v, = U("<I", p, 0); f["align"] = v; dc.textalign = v
    elif rt == 24:
        v, = U("<I", p, 0); dc.textcolor = colorref(v); f["color"] = dc.textcolor
    elif rt == 25:
        v, = U("<I", p, 0); dc.bkcolor = colorref(v); f["color"] = dc.bkcolor
    elif rt == 26:
        f["offset"] = list(U("<ii", p, 0))
    elif rt == 27:
        x, y = U("<ii", p, 0); f["pt"] = [x, y]
        dc.pos = (x, y)
        if gi.in_path:
            gi.path.append({"op": "moveto", "log": [[x, y]]})
    elif rt in (29, 30):
        r = rd_rect(p, 0); f["rect"] = r
        a, b = gi.to_dev(r[0], r[1]), gi.to_dev(r[2], r[3])
        dc.clip.append({"op": "exclude" if rt == 29 else "intersect", "dev": rndlist([a, b])})
    elif rt in (31, 32):
        f["xNum"], f["xDenom"], f["yNum"], f["yDenom"] = U("<iiii", p, 0)
        a, b, c, d = f["xNum"], f["xDenom"], f["yNum"], f["yDenom"]
        tgt = dc.vp_ext if rt == 31 else dc.win_ext
        newv = (tgt[0] * a // b if b else tgt[0], tgt[1] * c // d if d else tgt[1])
        if rt == 31:
            dc.vp_ext = newv
        else:
            dc.win_ext = newv
    elif rt == 33:
        gi.stack.append(dc.copy())
    elif rt == 34:
        v, = U("<i", p, 0); f["savedDC"] = v
        if gi.stack:
            idx = (len(gi.stack) + v) if v < 0 else (v - 1)
            idx = max(0, min(idx, len(gi.stack) - 1))
            gi.dc = gi.stack[idx]
            del gi.stack[idx:]
    elif rt == 35:
        x = U("<6f", p, 0); f["xform"] = [rnd(v, 6) for v in x]; dc.xform = tuple(x)
    elif rt == 36:
        x = U("<6f", p, 0); mode, = U("<I", p, 24)
        f["xform"] = [rnd(v, 6) for v in x]; f["mode"] = MWT_MODES.get(mode, mode)
        if mode == 1:
            dc.xform = IDENTITY
        elif mode == 2:
            dc.xform = mat_mul(tuple(x), dc.xform)
        elif mode == 3:
            dc.xform = mat_mul(dc.xform, tuple(x))
        elif mode == 4:
            dc.xform = tuple(x)
        f["result"] = [rnd(v, 6) for v in dc.xform]
    elif rt == 37:
        ih, = U("<I", p, 0)
        f["handle"] = ih if not ih & 0x80000000 else "stock:%s" % STOCK.get(ih & 0x7FFFFFFF, ("", "?%d" % (ih & 0x7FFFFFFF)))[1]
        gi.sel(ih)
    elif rt == 38:
        ih, style, wx, wy, col = U("<IIiiI", p, 0)
        o = {"kind": "pen", "handle": ih, "style": pen_style_name(style), "style_raw": style,
             "width": wx, "color": colorref(col)}
        gi.objects[ih] = o
        f.update(handle=ih, style=o["style"], width=wx, color=o["color"])
    elif rt == 95:
        ih, offBmi, cbBmi, offBits, cbBits = U("<IIIII", p, 0)
        style, width, bstyle, col, hatch, nent = U("<IIIIII", p, 20)
        o = {"kind": "pen", "handle": ih, "style": pen_style_name(style), "style_raw": style,
             "width": width, "color": colorref(col), "brush_style": BRUSH_STYLES.get(bstyle, bstyle)}
        if nent:
            o["dash"] = list(U("<%dI" % nent, p, 44))
        gi.objects[ih] = o
        f.update(handle=ih, style=o["style"], width=width, color=o["color"], brush_style=o["brush_style"])
        if nent:
            f["dash"] = o["dash"]
    elif rt == 39:
        ih, style, col, hatch = U("<IIII", p, 0)
        o = {"kind": "brush", "handle": ih, "style": BRUSH_STYLES.get(style, style), "color": colorref(col)}
        if style == 2:
            o["hatch"] = hatch
        if style == 1:
            o["color"] = None
        gi.objects[ih] = o
        f.update(handle=ih, style=o["style"], color=o["color"])
    elif rt == 40:
        ih, = U("<I", p, 0); f["handle"] = ih; gi.objects.pop(ih, None)
    elif rt == 41:
        cx, cy, r, st, sw = U("<iiIff", p, 0)
        f.update(center=[cx, cy], radius=r, start=rnd(st), sweep=rnd(sw))
        gi.emit("arc", [(cx, cy)], radius=r, start=rnd(st), sweep=rnd(sw), angle_arc=True)
    elif rt in (42, 43):
        r = rd_rect(p, 0); f["box"] = r
        gi.emit("ellipse" if rt == 42 else "rect", [(r[0], r[1]), (r[2], r[3])])
    elif rt == 44:
        r = rd_rect(p, 0); cw, ch = U("<ii", p, 16); f.update(box=r, corner=[cw, ch])
        gi.emit("roundrect", [(r[0], r[1]), (r[2], r[3])], corner=[cw, ch])
    elif rt in (45, 46, 47, 55):
        r = rd_rect(p, 0); st = list(U("<ii", p, 16)); en = list(U("<ii", p, 24))
        f.update(box=r, start=st, end=en, arcdir=dc.arcdir)
        kind = {45: "arc", 46: "chord", 47: "pie", 55: "arc"}[rt]
        gi.emit(kind, [(r[0], r[1]), (r[2], r[3]), tuple(st), tuple(en)], arcdir=dc.arcdir,
                **({"arcto": True} if rt == 55 else {}))
    elif rt == 54:
        x, y = U("<ii", p, 0); f["pt"] = [x, y]
        gi.emit("line", [dc.pos, (x, y)])
        dc.pos = (x, y)
    elif rt == 57:
        v, = U("<I", p, 0); f["dir"] = {1: "COUNTERCLOCKWISE", 2: "CLOCKWISE"}.get(v, v); dc.arcdir = v
    elif rt == 58:
        f["miter"], = U("<I", p, 0)
    elif rt == 59:
        gi.in_path = True; gi.path = []
    elif rt == 60:
        gi.in_path = False
    elif rt == 61:
        if gi.in_path:
            gi.path.append({"op": "close"})
    elif rt in (62, 63, 64):
        f["bounds"] = rd_rect(p, 0)
        ops = gi.path
        pts = [tuple(pt) for o in ops for pt in o.get("log", [])]
        mode = {62: "fill", 63: "strokefill", 64: "stroke"}[rt]
        was = gi.in_path
        gi.in_path = False
        gi.emit("path", pts, mode=mode, ops=[{"op": o["op"], "log": o.get("log", [])} for o in ops])
        gi.in_path = was
    elif rt == 67:
        f["mode"], = U("<I", p, 0)
        dc.clip.append({"op": "selectclippath", "mode": f["mode"], "path_ops": len(gi.path)})
    elif rt == 68:
        gi.in_path = False; gi.path = []
    elif rt == 70:
        pass  # 由调用方处理
    elif rt in (71, 72, 73, 74):
        f["bounds"] = rd_rect(p, 0)
        gi.emit("region", [(f["bounds"][0], f["bounds"][1]), (f["bounds"][2], f["bounds"][3])],
                op={71: "fill", 72: "frame", 73: "invert", 74: "paint"}[rt])
    elif rt == 75:
        cb, mode = U("<II", p, 0)
        f.update(cbRgnData=cb, mode=mode)
        if cb >= 32:
            # RGNDATAHEADER: dwSize, iType, nCount, nRgnSize, rcBound
            f["rcBound"] = list(U("<4i", p, 8 + 16))
        dc.clip.append({"op": "extselectclip", "mode": mode, "bound": f.get("rcBound")})
    elif rt in (76, 77, 78, 79, 80, 81, 114, 116):
        # 位图类: 只记目的矩形
        if rt in (76, 77, 78, 114, 116):
            f["bounds"] = rd_rect(p, 0)
            x, y, cx, cy = U("<iiii", p, 16)
            f["dest"] = [x, y, cx, cy]
            gi.emit("bitmap", [(x, y), (x + cx, y + cy)], record=RECORD_NAMES.get(rt))
        elif rt == 81:
            f["bounds"] = rd_rect(p, 0)
            x, y = U("<ii", p, 16)
            cx, cy = U("<ii", p, 64)  # cxDest, cyDest
            f["dest"] = [x, y, cx, cy]
            gi.emit("bitmap", [(x, y), (x + cx, y + cy)], record=RECORD_NAMES.get(rt))
        else:
            f["bounds"] = rd_rect(p, 0)
    elif rt == 82:
        ih, = U("<I", p, 0)
        h, w, esc, orient, weight = U("<5i", p, 4)
        it, ul, so, cs, op, cp, q, pf = U("<8B", p, 24)
        face = utf16(p[32:32 + 64]).split("\x00")[0]
        o = {"kind": "font", "handle": ih, "height": h, "width": w, "escapement": esc, "weight": weight,
             "italic": bool(it), "underline": bool(ul), "strikeout": bool(so), "charset": cs, "face": face}
        gi.objects[ih] = o
        f.update(handle=ih, face=face, height=h, weight=weight, italic=bool(it), escapement=esc, charset=cs)
    elif rt in (83, 84):
        bounds = rd_rect(p, 0)
        gm, ex, ey = U("<Iff", p, 16)
        rx, ry, nch, offs, opts = U("<iiIII", p, 28)
        rcl = rd_rect(p, 48)
        offdx, = U("<I", p, 64)
        sbytes = data[rec_off + offs: rec_off + offs + (nch * 2 if rt == 84 else nch)]
        if rt == 84:
            text = utf16(sbytes)
        else:
            text = sbytes.decode("gbk", errors="replace")
        f.update(bounds=bounds, graphicsMode=gm, ref=[rx, ry], nChars=nch, options=opts, text=text)
        if nch and offdx:
            m = nch * (2 if opts & 0x2000 else 1)
            try:
                f["dx"] = list(U("<%di" % m, data, rec_off + offdx))
            except struct.error:
                pass
        gi.emit("text", [(rx, ry)], text=text, color=dc.textcolor, font=_font_desc(dc.font),
                align=dc.textalign, options=opts)
    elif rt == 108:
        rx, ry, nch, opts, gm, ex, ey = U("<iiIIIff", p, 0)
        o = 28
        if not opts & 0x100:
            f["bounds"] = rd_rect(p, o); o += 16
        if opts & 0x200:
            text = p[o:o + nch].decode("latin-1")
        else:
            text = utf16(p[o:o + nch * 2])
        f.update(ref=[rx, ry], nChars=nch, options=opts, text=text)
        gi.emit("text", [(rx, ry)], text=text, color=dc.textcolor, font=_font_desc(dc.font),
                align=dc.textalign, options=opts)
    elif rt == 115:
        f["layout"], = U("<I", p, 0)
    elif rt == 118:
        f["bounds"] = rd_rect(p, 0)
        gi.emit("gradient", [(f["bounds"][0], f["bounds"][1]), (f["bounds"][2], f["bounds"][3])])
    elif rt == 98:
        f["mode"], = U("<I", p, 0)
    elif rt == 120:
        f["nBreakExtra"], f["nBreakCount"] = U("<ii", p, 0)
    return f


def _font_desc(f):
    if not f:
        return None
    return {k: f.get(k) for k in ("face", "height", "weight", "italic", "escapement", "charset", "stock")
            if f.get(k) is not None}


def _poly(gi, rt, pts):
    pts_t = [tuple(p) for p in pts]
    if rt in (2, 85):
        gi.emit("bezier", pts_t)
    elif rt in (3, 86):
        gi.emit("polygon", pts_t)
    elif rt in (4, 87):
        gi.emit("polyline", pts_t)
    elif rt in (5, 88):
        seq = [gi.dc.pos] + pts_t
        if gi.in_path:
            gi.path.append({"op": "bezierto", "log": [list(p) for p in pts_t]})
        else:
            gi.emit("bezier", seq)
        if pts_t:
            gi.dc.pos = pts_t[-1]
    elif rt in (6, 89):
        seq = [gi.dc.pos] + pts_t
        if gi.in_path:
            gi.path.append({"op": "lineto", "log": [list(p) for p in pts_t]})
        else:
            gi.emit("polyline", seq)
        if pts_t:
            gi.dc.pos = pts_t[-1]


# --------------------------------------------------------------------------- EMF+

class PlusInterp:
    def __init__(self, hdr):
        self.dpi = 96.0
        self.unit = 2
        self.scale = 1.0
        self.world = IDENTITY
        self.objects = {}
        self.pending = {}
        self.stack = {}
        self.prims = []
        self.clip = []
        self.hdr = hdr
        self.records = 0
        self.unknown = {}
        self.sink = None

    def unit_scale(self):
        u = self.unit
        if u in (0, 1, 2):
            return self.scale
        k = {3: self.dpi / 72.0, 4: self.dpi, 5: self.dpi / 300.0, 6: self.dpi / 25.4}.get(u, 1.0)
        return self.scale * k

    def dev(self, x, y):
        wx, wy = mat_apply(self.world, x, y)
        s = self.unit_scale()
        return (wx * s, wy * s)

    def emit(self, kind, pts, **extra):
        dev = [self.dev(x, y) for x, y in pts]
        k = 96.0 / self.dpi
        pr = {"layer": "emf+", "kind": kind, "log": rndlist(pts), "dev": rndlist(dev),
              "px96": rndlist([(d[0] * k, d[1] * k) for d in dev], 3)}
        pr.update(extra)
        pen = pr.get("pen")
        if isinstance(pen, dict) and isinstance(pen.get("width"), (int, float)):
            a, b = self.dev(0, 0), self.dev(1, 0)
            pen["width_px96"] = rnd(pen["width"] * math.hypot(b[0] - a[0], b[1] - a[1]) * 96.0 / self.dpi, 4)
        self.prims.append(pr)
        if self.sink is not None:
            self.sink.append(pr)


def _plus_points(b, o, count, compressed):
    if compressed:
        return [list(struct.unpack_from("<hh", b, o + 4 * i)) for i in range(count)], o + 4 * count
    return [list(struct.unpack_from("<ff", b, o + 8 * i)) for i in range(count)], o + 8 * count


def _plus_rects(b, o, count, compressed):
    out = []
    for i in range(count):
        if compressed:
            out.append(list(struct.unpack_from("<hhhh", b, o + 8 * i)))
        else:
            out.append(list(struct.unpack_from("<ffff", b, o + 16 * i)))
    return out


def decode_plus_object(pi, oid, otype, buf):
    """解码 EMF+ 对象。返回 dict (供图元引用)。"""
    U = struct.unpack_from
    o = {"kind": EMFPLUS_OBJ_TYPES.get(otype, "obj%d" % otype).lower(), "id": oid, "size": len(buf)}
    try:
        if otype == 1:  # Brush
            ver, bt = U("<II", buf, 0)
            o["brush_type"] = {0: "Solid", 1: "Hatch", 2: "Texture", 3: "PathGradient", 4: "LinearGradient"}.get(bt, bt)
            if bt == 0:
                c, = U("<I", buf, 8)
                o["color"], o["alpha"] = argb(c)
        elif otype == 2:  # Pen
            ver, pt = U("<II", buf, 0)
            pflags, punit, pwidth = U("<IIf", buf, 8)
            o.update(width=rnd(pwidth), unit=EMFPLUS_UNITS.get(punit, punit), pen_flags=pflags)
            q = 20
            if pflags & 0x1:
                q += 24
            if pflags & 0x2:
                o["start_cap"], = U("<i", buf, q); q += 4
            if pflags & 0x4:
                o["end_cap"], = U("<i", buf, q); q += 4
            if pflags & 0x8:
                o["join"], = U("<i", buf, q); q += 4
            if pflags & 0x10:
                o["miter"], = U("<f", buf, q); q += 4
            if pflags & 0x20:
                o["line_style"], = U("<i", buf, q); q += 4
            if pflags & 0x40:
                q += 4
            if pflags & 0x80:
                q += 4
            if pflags & 0x100:
                n, = U("<I", buf, q); o["dash"] = [rnd(v) for v in U("<%df" % n, buf, q + 4)]; q += 4 + 4 * n
            if pflags & 0x200:
                q += 4
            if pflags & 0x400:
                n, = U("<I", buf, q); q += 4 + 4 * n
            # 后面是笔刷对象
            bver, bt = U("<II", buf, q)
            if bt == 0:
                c, = U("<I", buf, q + 8)
                o["color"], o["alpha"] = argb(c)
            else:
                o["brush_type"] = bt
        elif otype == 3:  # Path
            ver, cnt, pflags = U("<III", buf, 0)
            comp = bool(pflags & 0x4000)
            rel = bool(pflags & 0x800)
            q = 12
            pts, q = _plus_points(buf, q, cnt, comp) if not rel else ([], q)
            types = list(buf[q:q + cnt])
            o.update(count=cnt, points=pts, types=types, compressed=comp, relative=rel)
        elif otype == 6:  # Font
            ver, em, unit, style, _res, ln = U("<IfIIII", buf, 0)
            o.update(em_size=rnd(em), unit=EMFPLUS_UNITS.get(unit, unit), style=style,
                     face=utf16(buf[24:24 + 2 * ln]).rstrip("\x00"))
        elif otype == 4:
            o["note"] = "region"
        elif otype == 5:
            ver, it = U("<II", buf, 0)
            o["image_type"] = {1: "Bitmap", 2: "Metafile"}.get(it, it)
    except struct.error as e:
        o["decode_error"] = str(e)
    return o


def _plus_brush(pi, flags, buf, o=0):
    """S 位(0x8000)=1: buf[o:o+4] 为 ARGB; 否则为画刷对象 id。返回 (desc, next_offset)。"""
    v, = struct.unpack_from("<I", buf, o)
    if flags & 0x8000:
        c, a = argb(v)
        return {"color": c, "alpha": a}, o + 4
    ob = pi.objects.get(v & 0xFF)
    return ({"color": ob.get("color"), "alpha": ob.get("alpha"), "obj": v & 0xFF} if ob else {"obj": v & 0xFF}), o + 4


def _pen_of(pi, pid):
    ob = pi.objects.get(pid)
    if not ob:
        return {"obj": pid}
    return {k: ob.get(k) for k in ("color", "alpha", "width", "dash", "start_cap", "end_cap", "join") if k in ob}


def path_to_prims(pi, path):
    """把 EMF+ 路径对象拆成子路径(含 Bezier)。"""
    subs, cur = [], None
    pts, types = path.get("points", []), path.get("types", [])
    i = 0
    while i < len(pts):
        t = types[i] & 0x0F if i < len(types) else 1
        fl = types[i] & 0xF0 if i < len(types) else 0
        if t == 0:
            if cur:
                subs.append(cur)
            cur = {"ops": [("M", [pts[i]])], "closed": bool(fl & 0x80)}
            i += 1
        elif t == 1:
            if cur is None:
                cur = {"ops": [], "closed": False}
            cur["ops"].append(("L", [pts[i]]))
            if fl & 0x80:
                cur["closed"] = True
            i += 1
        elif t == 3:
            seg = pts[i:i + 3]
            if cur is None:
                cur = {"ops": [], "closed": False}
            cur["ops"].append(("B", seg))
            if i + 2 < len(types) and types[i + 2] & 0x80:
                cur["closed"] = True
            i += 3
        else:
            i += 1
    if cur:
        subs.append(cur)
    return subs


def handle_plus_record(pi, rtype, flags, d):
    """处理一条 EMF+ 记录, 返回用于记录列表的 dict。"""
    U = struct.unpack_from
    name = EMFPLUS_NAMES.get(rtype, "0x%04x" % rtype)
    f = {"plus": name, "flags": "0x%04x" % flags, "data_size": len(d)}
    comp = bool(flags & 0x4000)
    try:
        if rtype == 0x4001:
            ver, pflags, dx, dy = U("<IIII", d, 0)
            pi.dpi = float(dx) if dx else 96.0
            f.update(version="0x%08x" % ver, display_ref=bool(pflags & 1), dpiX=dx, dpiY=dy, dual=bool(flags & 1))
        elif rtype == 0x4008:
            oid = flags & 0xFF
            otype = (flags >> 8) & 0x7F
            cont = bool(flags & 0x8000)
            f.update(object_id=oid, object_type=EMFPLUS_OBJ_TYPES.get(otype, otype), continued=cont)
            buf = None
            if cont:
                if oid in pi.pending:
                    pi.pending[oid][2].extend(d)
                else:
                    total, = U("<I", d, 0)
                    pi.pending[oid] = [otype, total, bytearray(d[4:])]
                if len(pi.pending[oid][2]) >= pi.pending[oid][1]:
                    buf = bytes(pi.pending.pop(oid)[2])
            else:
                buf = bytes(d)
            if buf is not None:
                ob = decode_plus_object(pi, oid, otype, buf)
                pi.objects[oid] = ob
                f["object"] = {k: v for k, v in ob.items() if k not in ("points", "types")}
                if otype == 3:
                    f["object"]["npoints"] = ob.get("count")
        elif rtype == 0x4009:
            c, a = argb(U("<I", d, 0)[0]); f.update(color=c, alpha=a)
        elif rtype in (0x400A, 0x400B):  # FillRects / DrawRects
            o = 0
            if rtype == 0x400A:
                br, o = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
            cnt, = U("<I", d, o)
            rects = _plus_rects(d, o + 4, cnt, comp)
            f["rects"] = rects
            for r in rects:
                pts = [(r[0], r[1]), (r[0] + r[2], r[1] + r[3])]
                if rtype == 0x400A:
                    pi.emit("rect", pts, brush=br, fill=True)
                else:
                    pi.emit("rect", pts, pen=_pen_of(pi, flags & 0xFF))
        elif rtype in (0x400C, 0x400D, 0x4019):  # FillPolygon / DrawLines / DrawBeziers
            o = 0
            if rtype == 0x400C:
                br, o = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
            cnt, = U("<I", d, o)
            pts, _ = _plus_points(d, o + 4, cnt, comp)
            f["points"] = rndlist(pts)
            if rtype == 0x400C:
                pi.emit("polygon", pts, brush=br, fill=True)
            elif rtype == 0x400D:
                closed = bool(flags & 0x2000)
                pi.emit("polyline", pts + ([pts[0]] if closed and pts else []), pen=_pen_of(pi, flags & 0xFF),
                        **({"closed": True} if closed else {}))
            else:
                pi.emit("bezier", pts, pen=_pen_of(pi, flags & 0xFF))
        elif rtype in (0x400E, 0x400F):  # FillEllipse / DrawEllipse
            o = 0
            if rtype == 0x400E:
                br, o = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
            r = _plus_rects(d, o, 1, comp)[0]
            f["rect"] = r
            pts = [(r[0], r[1]), (r[0] + r[2], r[1] + r[3])]
            if rtype == 0x400E:
                pi.emit("ellipse", pts, brush=br, fill=True)
            else:
                pi.emit("ellipse", pts, pen=_pen_of(pi, flags & 0xFF))
        elif rtype in (0x4010, 0x4011, 0x4012):  # FillPie / DrawPie / DrawArc
            o = 0
            if rtype == 0x4010:
                br, o = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
            st, sw = U("<ff", d, o)
            r = _plus_rects(d, o + 8, 1, comp)[0]
            f.update(start=rnd(st), sweep=rnd(sw), rect=r)
            kind = "arc" if rtype == 0x4012 else "pie"
            extra = {"brush": br, "fill": True} if rtype == 0x4010 else {"pen": _pen_of(pi, flags & 0xFF)}
            pi.emit(kind, [(r[0], r[1]), (r[0] + r[2], r[1] + r[3])], start=rnd(st), sweep=rnd(sw), **extra)
        elif rtype in (0x4014, 0x4015, 0x4037):  # FillPath / DrawPath / StrokeFillPath
            pid = flags & 0xFF
            path = pi.objects.get(pid, {})
            subs = path_to_prims(pi, path) if path else []
            allpts = [tuple(p) for p in path.get("points", [])]
            f["path_id"] = pid
            if rtype == 0x4014:
                br, _ = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
                extra = {"mode": "fill", "brush": br}
            elif rtype == 0x4015:
                penid, = U("<I", d, 0)
                f["pen_id"] = penid
                extra = {"mode": "stroke", "pen": _pen_of(pi, penid)}
            else:
                penid, brid = U("<II", d, 0)
                f["pen_id"] = penid
                extra = {"mode": "strokefill", "pen": _pen_of(pi, penid),
                         "brush": {"obj": brid & 0xFF, **({k: pi.objects[brid & 0xFF].get(k) for k in ("color", "alpha")} if (brid & 0xFF) in pi.objects else {})}}
            if allpts:
                subd = [{"closed": s["closed"], "ops": [[op, rndlist(ps)] for op, ps in s["ops"]]} for s in subs]
                pi.emit("path", allpts, subpaths=subd, **extra)
        elif rtype == 0x4018 or rtype in (0x4016, 0x4017):  # curves
            o = 0
            if rtype == 0x4016:
                br, o = _plus_brush(pi, flags, d, 0)
                f["brush"] = br
            if rtype == 0x4018:
                tension, off, nseg, cnt = U("<fIII", d, o); o += 16
            else:
                tension, = U("<f", d, o); cnt, = U("<I", d, o + 4); o += 8
            pts, _ = _plus_points(d, o, cnt, comp)
            f["points"] = rndlist(pts)
            f["tension"] = rnd(tension)
            pi.emit("curve", pts, tension=rnd(tension), closed=(rtype != 0x4018),
                    **({"brush": br, "fill": True} if rtype == 0x4016 else {"pen": _pen_of(pi, flags & 0xFF)}))
        elif rtype == 0x401C:  # DrawString
            br, o = _plus_brush(pi, flags, d, 0)
            fmt, ln = U("<II", d, o)
            rect = list(U("<4f", d, o + 8))
            text = utf16(d[o + 24:o + 24 + 2 * ln])
            font = pi.objects.get(flags & 0xFF, {})
            f.update(text=text, rect=rndlist([rect[:2], rect[2:]]), brush=br)
            pi.emit("text", [(rect[0], rect[1])], text=text, color=br.get("color"), alpha=br.get("alpha"),
                    font={k: font.get(k) for k in ("face", "em_size", "style", "unit") if k in font},
                    layout_wh=[rnd(rect[2]), rnd(rect[3])])
        elif rtype == 0x4036:  # DrawDriverString
            br, o = _plus_brush(pi, flags, d, 0)
            opts, mpresent, gcnt = U("<III", d, o)
            o += 12
            glyphs = list(U("<%dH" % gcnt, d, o)); o += 2 * gcnt
            if o % 4:
                o += 4 - o % 4  # 字形数组后按 4 字节对齐(待样本核实)
            pos = []
            q = o
            for i in range(gcnt):
                pos.append(list(U("<ff", d, q + 8 * i)))
            text = "".join(chr(g) for g in glyphs) if opts & 1 else None
            font = pi.objects.get(flags & 0xFF, {})
            f.update(options=opts, glyph_count=gcnt, text=text, glyphs=glyphs[:64], positions=rndlist(pos[:64]))
            if pos:
                pi.emit("text", [tuple(pos[0])], text=text, glyphs=glyphs if text is None else None,
                        color=br.get("color"), alpha=br.get("alpha"),
                        font={k: font.get(k) for k in ("face", "em_size", "style", "unit") if k in font},
                        positions=rndlist(pos))
        elif rtype == 0x402A:
            m = U("<6f", d, 0); pi.world = tuple(m); f["matrix"] = [rnd(v, 6) for v in m]
        elif rtype == 0x402B:
            pi.world = IDENTITY
        elif rtype == 0x402C:
            m = tuple(U("<6f", d, 0)); f["matrix"] = [rnd(v, 6) for v in m]
            pi.world = mat_mul(pi.world, m) if flags & 0x2000 else mat_mul(m, pi.world)
        elif rtype == 0x402D:
            dx, dy = U("<ff", d, 0); f["d"] = [rnd(dx), rnd(dy)]
            m = (1, 0, 0, 1, dx, dy)
            pi.world = mat_mul(pi.world, m) if flags & 0x2000 else mat_mul(m, pi.world)
        elif rtype == 0x402E:
            sx, sy = U("<ff", d, 0); f["s"] = [rnd(sx), rnd(sy)]
            m = (sx, 0, 0, sy, 0, 0)
            pi.world = mat_mul(pi.world, m) if flags & 0x2000 else mat_mul(m, pi.world)
        elif rtype == 0x402F:
            a, = U("<f", d, 0); f["angle"] = rnd(a)
            c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
            m = (c, s, -s, c, 0, 0)
            pi.world = mat_mul(pi.world, m) if flags & 0x2000 else mat_mul(m, pi.world)
        elif rtype == 0x4030:
            pi.unit = flags & 0xFF
            pi.scale, = U("<f", d, 0)
            f.update(unit=EMFPLUS_UNITS.get(pi.unit, pi.unit), scale=rnd(pi.scale))
        elif rtype in (0x4025, 0x4028, 0x4027):
            idx, = U("<I", d, len(d) - 4) if rtype != 0x4027 else U("<I", d, 32)
            pi.stack[idx] = (pi.world, pi.unit, pi.scale)
            f["stack_index"] = idx
        elif rtype in (0x4026, 0x4029):
            idx, = U("<I", d, 0)
            f["stack_index"] = idx
            if idx in pi.stack:
                pi.world, pi.unit, pi.scale = pi.stack.pop(idx)
        elif rtype == 0x4031:
            pi.clip = []
        elif rtype == 0x4032:
            r = list(U("<4f", d, 0)); mode = (flags >> 8) & 0xF
            pi.clip.append({"op": "rect", "mode": mode, "rect": rndlist([r[:2], r[2:]])}); f.update(mode=mode, rect=r)
        elif rtype == 0x4033:
            pi.clip.append({"op": "path", "mode": (flags >> 8) & 0xF, "path_id": flags & 0xFF})
        elif rtype == 0x4034:
            pi.clip.append({"op": "region", "mode": (flags >> 8) & 0xF, "region_id": flags & 0xFF})
        elif rtype == 0x401E:
            f["antialias"] = bool(flags & 1); f["mode"] = (flags >> 1) & 0x7F
        elif rtype in (0x401A, 0x401B):
            f["note"] = "image draw (not decoded)"
            f["image_id"] = flags & 0xFF
            pi.emit("image", [(0, 0)], note="DrawImage not decoded")
        elif rtype == 0x4003:
            f["comment"] = hexpreview(d)
    except (struct.error, IndexError) as e:
        f["decode_error"] = str(e)
    return f


def walk_plus(pi, comment_payload, rec_index, out_records):
    """comment_payload 为 'EMF+' 之后的内容。"""
    p, end = 0, len(comment_payload)
    while p + 12 <= end:
        rtype, flags, size, dsize = struct.unpack_from("<HHII", comment_payload, p)
        if size < 12 or p + size > end + 3:
            out_records.append({"plus": "BAD_RECORD", "offset_in_comment": p, "size": size})
            break
        d = comment_payload[p + 12:p + 12 + dsize]
        pi.records += 1
        if rtype not in EMFPLUS_NAMES:
            pi.unknown[rtype] = pi.unknown.get(rtype, 0) + 1
        out_records.append(handle_plus_record(pi, rtype, flags, d))
        p += size


# --------------------------------------------------------------------------- 主解析

def parse_header(data):
    h = {}
    t, size = struct.unpack_from("<II", data, 0)
    if t != 1:
        raise ValueError("not an EMF: first record type %d" % t)
    h["header_size"] = size
    h["bounds"] = list(struct.unpack_from("<4i", data, 8))
    h["frame_0.01mm"] = list(struct.unpack_from("<4i", data, 24))
    sig, ver, nbytes, nrec, nhandles, res, ndesc, offdesc, npal = struct.unpack_from("<IIIIHHIII", data, 40)
    h["signature"] = "0x%08x" % sig
    h["signature_ok"] = sig == 0x464D4520
    h["version"] = "0x%08x" % ver
    h["nBytes"] = nbytes
    h["nRecords"] = nrec
    h["nHandles"] = nhandles
    h["device"] = list(struct.unpack_from("<2i", data, 72))
    h["millimeters"] = list(struct.unpack_from("<2i", data, 80))
    if ndesc and offdesc < len(data):
        h["description"] = utf16(data[offdesc:offdesc + ndesc * 2]).replace("\x00", " | ").strip(" |")
    if size >= 100:
        h["micrometers"] = list(struct.unpack_from("<2i", data, 96))
    fr = h["frame_0.01mm"]
    h["frame_mm"] = [rnd((fr[2] - fr[0]) / 100.0, 3), rnd((fr[3] - fr[1]) / 100.0, 3)]
    if h["millimeters"][0]:
        h["dpi"] = rnd(h["device"][0] / (h["millimeters"][0] / 25.4), 3)
    return h


DECODED_TYPES = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27,
                 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 54, 55, 56,
                 57, 58, 59, 60, 61, 62, 63, 64, 67, 68, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
                 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 95, 98, 108, 114, 115, 116, 118, 120}


def prescan_plus_dpi(data):
    """找第一个 EMF+ Header 记录, 取其 LogicalDpiX(比 device/mm 推算更准)。"""
    off, n = 0, len(data)
    while off + 8 <= n:
        rt, sz = struct.unpack_from("<II", data, off)
        if sz < 8 or off + sz > n:
            return None
        if rt == 70 and sz >= 28 and data[off + 12:off + 16] == b"EMF+":
            rtype, flags, size, dsize = struct.unpack_from("<HHII", data, off + 16)
            if rtype == 0x4001 and dsize >= 16:
                v = struct.unpack_from("<I", data, off + 16 + 12 + 8)[0]
                return float(v) if v else None
        if rt == 14:
            return None
        off += sz
        if off > 4096 and rt not in (1, 70):
            return None
    return None


def parse_emf(data, with_records=True):
    hdr = parse_header(data)
    pdpi = prescan_plus_dpi(data)
    if pdpi:
        hdr["dpi_emfplus"] = pdpi
        hdr["dpi"] = pdpi
    gi = GdiInterp(hdr)
    pi = PlusInterp(hdr)
    combined = []
    gi.sink = combined
    pi.sink = combined
    has_plus_header = bool(pdpi)
    records = []
    unknown = {}
    undecoded = {}
    comments = {}
    counts = {}
    off, idx = 0, 0
    last_type = None
    issues = []
    n = len(data)
    plus_dpi_set = False
    while off + 8 <= n:
        rt, sz = struct.unpack_from("<II", data, off)
        if sz < 8 or sz % 4 or off + sz > n:
            issues.append("bad record size %d at offset %d (type %d)" % (sz, off, rt))
            break
        p = data[off + 8: off + sz]
        counts[rt] = counts.get(rt, 0) + 1
        rec = {"i": idx, "off": off, "type": rt, "name": RECORD_NAMES.get(rt, "UNKNOWN_%d" % rt), "size": sz}
        try:
            if rt == 1:
                rec.update(bounds=hdr["bounds"], frame=hdr["frame_0.01mm"], device=hdr["device"],
                           millimeters=hdr["millimeters"])
            elif rt == 70:
                dsz, = struct.unpack_from("<I", p, 0)
                ident = bytes(p[4:8])
                body = p[4: 4 + dsz]
                if ident == b"EMF+":
                    plus_recs = []
                    walk_plus(pi, body[4:], idx, plus_recs)
                    if plus_recs:
                        gi.live = plus_recs[-1].get("plus") == "GetDC"
                    if not plus_dpi_set and pi.dpi:
                        plus_dpi_set = True
                    rec.update(comment="EMF+", plus=plus_recs)
                    comments["EMF+"] = comments.get("EMF+", 0) + 1
                elif ident == b"GDIC":
                    ctype, = struct.unpack_from("<I", body, 4) if len(body) >= 8 else (None,)
                    nm = {1: "WINDOWS_METAFILE", 2: "BEGINGROUP", 3: "ENDGROUP", 0x40000004: "MULTIFORMATS"}.get(ctype, str(ctype))
                    rec.update(comment="GDIC", gdic=nm)
                    if ctype == 2 and len(body) >= 24:
                        rec["group_bounds"] = list(struct.unpack_from("<4i", body, 8))
                    comments["GDIC:" + nm] = comments.get("GDIC:" + nm, 0) + 1
                else:
                    ident_s = ident.decode("latin-1")
                    rec.update(comment=ident_s if ident_s.isprintable() else ident.hex(), preview=hexpreview(body[4:], 32), comment_size=dsz)
                    comments[rec["comment"]] = comments.get(rec["comment"], 0) + 1
            elif rt in RECORD_NAMES:
                rec.update(decode_gdi(rt, p, gi, off, data))
            else:
                unknown[rt] = unknown.get(rt, {"count": 0, "bytes": 0})
                unknown[rt]["count"] += 1
                unknown[rt]["bytes"] += sz
                rec["preview"] = hexpreview(p)
            if rt in RECORD_NAMES and rt not in DECODED_TYPES:
                u = undecoded.setdefault(RECORD_NAMES[rt], {"count": 0, "bytes": 0})
                u["count"] += 1
                u["bytes"] += sz
                rec["preview"] = hexpreview(p)
        except (struct.error, IndexError, ValueError) as e:
            rec["decode_error"] = "%s: %s" % (type(e).__name__, e)
        if rt in RECORD_NAMES and rt not in (1, 70) and rec.get("name") and rt not in unknown:
            pass
        if with_records:
            records.append(rec)
        last_type = rt
        idx += 1
        off += sz
        if rt == 14:
            break
    # 验证
    if last_type != 14:
        issues.append("missing EMR_EOF (last record type %s)" % last_type)
    if hdr["nBytes"] != n:
        issues.append("header nBytes %d != file size %d" % (hdr["nBytes"], n))
    if hdr["nRecords"] != idx:
        issues.append("header nRecords %d != parsed %d" % (hdr["nRecords"], idx))
    if not hdr["signature_ok"]:
        issues.append("bad EMF signature")
    # 图元: 设置 dpi 供 px96 使用
    k_gdi = 96.0 / (hdr.get("dpi") or 96.0)
    gdi_prims = gi.prims
    # GDI 解释器在解析中已按构造时的 dpi 计算 px96 (header 的 dpi)
    plus_prims = pi.prims
    if not with_records:
        records = None
    has_plus = any(pr for pr in plus_prims)
    if has_plus_header and not has_plus:
        has_plus = any(r.get("plus") for r in [])  # EMF+ 头存在但没有 EMF+ 图元: 退回 GDI
    result = {
        "header": hdr,
        "emfplus": {"records": pi.records, "dpi": pi.dpi, "unknown_types": {"0x%04x" % k: v for k, v in pi.unknown.items()}},
        "record_counts": {RECORD_NAMES.get(k, "UNKNOWN_%d" % k): v for k, v in sorted(counts.items())},
        "comment_counts": comments,
        "unknown_records": {str(k): v for k, v in unknown.items()},
        "undecoded_records": undecoded,
        "primitives_gdi": gdi_prims,
        "primitives_emfplus": plus_prims,
        "records": records,
        "validation": {"ok": not issues, "issues": issues, "n_records": idx, "has_emfplus": pi.records > 0,
                       "draw_records": sum(v for k, v in counts.items() if k in DRAW_RECORD_TYPES)},
    }
    live_gdi = [p for p in gdi_prims if not p.get("mirror")]
    result["primitives"] = combined if has_plus else gdi_prims
    result["primitives_layer"] = "emf+ & live-gdi" if has_plus else "gdi"
    result["primitives_gdi_live"] = live_gdi
    return result


def canonical_digest(res, ndigits=2):
    """图元级规范化摘要: 忽略 EMF+ 对象槽位号、LOGFONT 填充字节等每次导出都会变的内容,
    只看 图元种类 + 96dpi 坐标 + 笔/刷颜色宽度 + 文字。同一输入多次导出摘要应相同。"""
    import hashlib

    def r(v):
        return round(v, ndigits)

    items = []
    for p in res["primitives"]:
        pen = p.get("pen") or {}
        br = p.get("brush") or {}
        items.append([p.get("layer"), p.get("kind"), p.get("mode"),
                      [[r(x), r(y)] for x, y in p.get("px96", [])],
                      pen.get("color"), pen.get("alpha"), pen.get("width_px96"), str(pen.get("style")),
                      br.get("color"), br.get("alpha"), p.get("text"), p.get("color")])
    return hashlib.sha256(json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def quick_check(data):
    """只扫记录头, 不解码内容: 用于 oracle 对导出文件做快速有效性检查。
    返回 dict: ok, issues, n_records, has_emfplus, draw_records, bounds, frame_mm, nBytes。"""
    issues = []
    try:
        hdr = parse_header(data)
    except Exception as e:  # noqa
        return {"ok": False, "issues": ["header: %s" % e], "n_records": 0}
    n = len(data)
    off, idx, last, has_plus, draw = 0, 0, None, False, 0
    while off + 8 <= n:
        rt, sz = struct.unpack_from("<II", data, off)
        if sz < 8 or sz % 4 or off + sz > n:
            issues.append("bad record size %d at %d" % (sz, off))
            break
        if rt in DRAW_RECORD_TYPES:
            draw += 1
        if rt == 70 and sz >= 16 and data[off + 12:off + 16] == b"EMF+":
            has_plus = True
        last = rt
        idx += 1
        off += sz
        if rt == 14:
            break
    if last != 14:
        issues.append("missing EMR_EOF")
    if hdr["nBytes"] != n:
        issues.append("nBytes %d != size %d" % (hdr["nBytes"], n))
    if hdr["nRecords"] != idx:
        issues.append("nRecords %d != %d" % (hdr["nRecords"], idx))
    if not hdr["signature_ok"]:
        issues.append("bad signature")
    return {"ok": not issues, "issues": issues, "n_records": idx, "has_emfplus": has_plus,
            "draw_records": draw, "bounds": hdr["bounds"], "frame_mm": hdr["frame_mm"], "nBytes": hdr["nBytes"]}


# --------------------------------------------------------------------------- 文本输出

def fmt_value(v):
    if isinstance(v, list):
        if len(v) > 12 and all(isinstance(x, list) for x in v):
            return "[%d pts: %s ... %s]" % (len(v), json.dumps(v[0]), json.dumps(v[-1]))
        if len(v) > 24:
            return "[%d items]" % len(v)
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


def print_header(h, out):
    out.write("== EMF header ==\n")
    out.write("  bounds (device px)     : %s\n" % h["bounds"])
    out.write("  frame (0.01 mm)        : %s  (= %s mm)\n" % (h["frame_0.01mm"], h["frame_mm"]))
    out.write("  device (px)            : %s\n" % h["device"])
    out.write("  millimeters            : %s   (dpi ~ %s)\n" % (h["millimeters"], h.get("dpi")))
    out.write("  nBytes/nRecords/handles: %s / %s / %s\n" % (h["nBytes"], h["nRecords"], h["nHandles"]))
    out.write("  version/signature      : %s / %s\n" % (h["version"], h["signature"]))
    if "micrometers" in h:
        out.write("  micrometers            : %s\n" % h["micrometers"])
    if h.get("description"):
        out.write("  description            : %s\n" % h["description"])


def print_records(res, out):
    out.write("== records ==\n")
    for r in res["records"]:
        extra = {k: v for k, v in r.items() if k not in ("i", "off", "type", "name", "size", "plus")}
        line = "[%4d] @%-6d %-26s size=%-5d" % (r["i"], r["off"], r["name"], r["size"])
        if extra:
            line += " " + " ".join("%s=%s" % (k, fmt_value(v)) for k, v in extra.items())
        out.write(line + "\n")
        for pr in r.get("plus", []) or []:
            pe = {k: v for k, v in pr.items() if k not in ("plus",)}
            out.write("        EMF+ %-22s %s\n" % (pr.get("plus"), " ".join("%s=%s" % (k, fmt_value(v)) for k, v in pe.items())))


def pen_str(pr):
    p = pr.get("pen")
    if not p:
        return ""
    w = p.get("width_px96", p.get("width"))
    return " pen=%s/w%s%s" % (p.get("color"), w, "" if p.get("style") in (None, "SOLID") else "/" + str(p.get("style")).split("|")[0])


def brush_str(pr):
    b = pr.get("brush")
    if not b:
        return ""
    return " fill=%s" % b.get("color")


def print_primitives(res, out, layer="auto"):
    if layer == "gdi":
        prims, name = res["primitives_gdi"], "gdi (all, including EMF+ mirror copies)"
    elif layer == "emfplus":
        prims, name = res["primitives_emfplus"], "emf+"
    else:
        prims, name = res["primitives"], res["primitives_layer"]
    out.write("== primitives (layer=%s, n=%d; coordinates in 96-dpi px = device px * 96/dpi) ==\n" % (name, len(prims)))
    for i, pr in enumerate(prims):
        pts = pr["px96"]
        if len(pts) > 6:
            ptxt = " ".join("(%g,%g)" % tuple(p) for p in pts[:3]) + " ... (%g,%g) [%d pts]" % (pts[-1][0], pts[-1][1], len(pts))
        else:
            ptxt = " ".join("(%g,%g)" % tuple(p) for p in pts)
        extra = ""
        if pr["kind"] == "text":
            extra = " text=%r color=%s" % (pr.get("text"), pr.get("color"))
        if pr["kind"] == "path":
            extra = " mode=%s subpaths=%d" % (pr.get("mode"), len(pr.get("subpaths", pr.get("ops", []))))
        out.write("  #%-3d %-9s %s%s%s%s\n" % (i, pr["kind"], ptxt, pen_str(pr), brush_str(pr), extra))


def main(argv=None):
    ap = argparse.ArgumentParser(description="EMF / EMF+ 解析器 (stdlib only)")
    ap.add_argument("emf")
    ap.add_argument("--json", help="写出完整 JSON")
    ap.add_argument("--primitives", action="store_true", help="只打印图元摘要")
    ap.add_argument("--layer", choices=["auto", "gdi", "emfplus"], default="auto",
                    help="auto = EMF+ 图元 + 真正生效的 GDI 图元(文字/按钮等) 按记录顺序合并; gdi = 全部 GDI 图元(含镜像副本); emfplus = 仅 EMF+")
    ap.add_argument("--no-records", action="store_true", help="不打印逐条记录")
    ap.add_argument("--summary", action="store_true", help="只打印头信息和记录计数")
    ap.add_argument("--digest", action="store_true", help="只打印图元级规范化 SHA-256 (忽略对象槽位号等噪声)")
    args = ap.parse_args(argv)
    data = open(args.emf, "rb").read()
    res = parse_emf(data, with_records=not args.digest)
    if args.digest:
        print(canonical_digest(res))
        return 0
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(res, fh, ensure_ascii=False, indent=1)
    out = sys.stdout
    try:
        out.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print_header(res["header"], out)
    out.write("== validation: %s %s\n" % ("OK" if res["validation"]["ok"] else "PROBLEMS", res["validation"]["issues"] or ""))
    out.write("== record counts: %s\n" % json.dumps(res["record_counts"], ensure_ascii=False))
    out.write("== comments: %s   EMF+ records: %d\n" % (json.dumps(res["comment_counts"]), res["emfplus"]["records"]))
    if res["unknown_records"]:
        out.write("== UNKNOWN records (type: count/bytes): %s\n" % json.dumps(res["unknown_records"]))
    if res["emfplus"]["unknown_types"]:
        out.write("== UNKNOWN EMF+ record types: %s\n" % json.dumps(res["emfplus"]["unknown_types"]))
    if args.summary:
        return 0
    if not args.primitives and not args.no_records:
        print_records(res, out)
    print_primitives(res, out, args.layer)
    return 0 if res["validation"]["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
