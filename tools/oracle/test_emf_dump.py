#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""emf_dump.py 的自测: 用 Windows GDI 现场画一个 EMF(只用本进程的 GDI, 不碰任何别的程序),
再用 emf_dump 解析, 核对关键记录与图元。只在 Windows 上运行。

    python tools/oracle/test_emf_dump.py
"""
import ctypes
import os
import sys
import tempfile
from ctypes import wintypes

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import emf_dump  # noqa: E402

gdi = ctypes.WinDLL("gdi32", use_last_error=True)
HDC = wintypes.HANDLE


def setup_prototypes():
    gdi.CreateEnhMetaFileW.restype = HDC
    gdi.CreateEnhMetaFileW.argtypes = [HDC, wintypes.LPCWSTR, ctypes.c_void_p, wintypes.LPCWSTR]
    gdi.CloseEnhMetaFile.restype = wintypes.HANDLE
    gdi.CloseEnhMetaFile.argtypes = [HDC]
    gdi.DeleteEnhMetaFile.argtypes = [wintypes.HANDLE]
    gdi.CreatePen.restype = wintypes.HANDLE
    gdi.CreatePen.argtypes = [ctypes.c_int, ctypes.c_int, wintypes.COLORREF]
    gdi.CreateSolidBrush.restype = wintypes.HANDLE
    gdi.CreateSolidBrush.argtypes = [wintypes.COLORREF]
    gdi.SelectObject.restype = wintypes.HANDLE
    gdi.SelectObject.argtypes = [HDC, wintypes.HANDLE]
    gdi.DeleteObject.argtypes = [wintypes.HANDLE]
    gdi.SetMapMode.argtypes = [HDC, ctypes.c_int]
    gdi.SetWindowExtEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi.SetViewportExtEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi.SetWindowOrgEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi.SetViewportOrgEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi.MoveToEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    gdi.LineTo.argtypes = [HDC, ctypes.c_int, ctypes.c_int]
    gdi.Polyline.argtypes = [HDC, ctypes.c_void_p, ctypes.c_int]
    gdi.Polygon.argtypes = [HDC, ctypes.c_void_p, ctypes.c_int]
    gdi.PolyBezier.argtypes = [HDC, ctypes.c_void_p, wintypes.DWORD]
    gdi.PolyPolyline.argtypes = [HDC, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD]
    gdi.Ellipse.argtypes = [HDC] + [ctypes.c_int] * 4
    gdi.Rectangle.argtypes = [HDC] + [ctypes.c_int] * 4
    gdi.RoundRect.argtypes = [HDC] + [ctypes.c_int] * 6
    gdi.Arc.argtypes = [HDC] + [ctypes.c_int] * 8
    gdi.Chord.argtypes = [HDC] + [ctypes.c_int] * 8
    gdi.Pie.argtypes = [HDC] + [ctypes.c_int] * 8
    gdi.TextOutW.argtypes = [HDC, ctypes.c_int, ctypes.c_int, wintypes.LPCWSTR, ctypes.c_int]
    gdi.SetTextColor.argtypes = [HDC, wintypes.COLORREF]
    gdi.SaveDC.argtypes = [HDC]
    gdi.RestoreDC.argtypes = [HDC, ctypes.c_int]
    gdi.IntersectClipRect.argtypes = [HDC] + [ctypes.c_int] * 4
    gdi.SetGraphicsMode.argtypes = [HDC, ctypes.c_int]
    gdi.SetWorldTransform.argtypes = [HDC, ctypes.c_void_p]


class XFORM(ctypes.Structure):
    _fields_ = [("eM11", ctypes.c_float), ("eM12", ctypes.c_float), ("eM21", ctypes.c_float),
                ("eM22", ctypes.c_float), ("eDx", ctypes.c_float), ("eDy", ctypes.c_float)]


def rgb(r, g, b):
    return r | (g << 8) | (b << 16)


def make_emf(path):
    setup_prototypes()
    dc = gdi.CreateEnhMetaFileW(None, path, None, None)
    assert dc, "CreateEnhMetaFile failed"
    pen = gdi.CreatePen(0, 3, rgb(0x12, 0x34, 0x56))
    brush = gdi.CreateSolidBrush(rgb(0xAA, 0xBB, 0xCC))
    gdi.SelectObject(dc, pen)
    gdi.SelectObject(dc, brush)
    gdi.MoveToEx(dc, 10, 20, None)
    gdi.LineTo(dc, 110, 220)
    pts = (ctypes.c_long * 8)(0, 0, 50, 0, 50, 50, 0, 50)  # 4 个点
    gdi.Polyline(dc, pts, 4)
    gdi.Polygon(dc, pts, 4)
    bez = (ctypes.c_long * 8)(0, 0, 10, 40, 40, 40, 50, 0)
    gdi.PolyBezier(dc, bez, 4)
    cnts = (wintypes.DWORD * 2)(2, 2)
    pp = (ctypes.c_long * 8)(0, 0, 5, 5, 10, 10, 15, 15)
    gdi.PolyPolyline(dc, pp, cnts, 2)
    gdi.Ellipse(dc, 100, 100, 160, 140)
    gdi.Rectangle(dc, 200, 200, 260, 240)
    gdi.RoundRect(dc, 300, 300, 360, 340, 10, 10)
    gdi.Arc(dc, 400, 400, 460, 440, 460, 420, 430, 400)
    gdi.Chord(dc, 500, 400, 560, 440, 560, 420, 530, 400)
    gdi.Pie(dc, 600, 400, 660, 440, 660, 420, 630, 400)
    gdi.SaveDC(dc)
    gdi.SetMapMode(dc, 8)  # MM_ANISOTROPIC
    gdi.SetWindowOrgEx(dc, 10, 10, None)
    gdi.SetWindowExtEx(dc, 100, 100, None)
    gdi.SetViewportOrgEx(dc, 1000, 2000, None)
    gdi.SetViewportExtEx(dc, 200, 300, None)
    gdi.MoveToEx(dc, 10, 10, None)
    gdi.LineTo(dc, 110, 110)  # 设备坐标 (1000,2000)-(1000+200, 2000+300)
    gdi.RestoreDC(dc, -1)
    gdi.SetGraphicsMode(dc, 2)  # GM_ADVANCED
    xf = XFORM(2.0, 0.0, 0.0, 3.0, 5.0, 7.0)
    gdi.SetWorldTransform(dc, ctypes.byref(xf))
    gdi.MoveToEx(dc, 1, 1, None)
    gdi.LineTo(dc, 11, 11)  # 页面坐标 (7,10)-(27,40)
    gdi.IntersectClipRect(dc, 0, 0, 1000, 1000)
    gdi.SetTextColor(dc, rgb(1, 2, 3))
    gdi.TextOutW(dc, 33, 44, "Hello中文", 7)
    h = gdi.CloseEnhMetaFile(dc)
    gdi.DeleteEnhMetaFile(h)
    gdi.DeleteObject(pen)
    gdi.DeleteObject(brush)


def main():
    if sys.platform != "win32":
        print("skip: Windows only")
        return 0
    path = os.path.join(tempfile.mkdtemp(prefix="emf_selftest_"), "t.emf")
    make_emf(path)
    res = emf_dump.parse_emf(open(path, "rb").read())
    bad = []

    def check(cond, msg):
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            bad.append(msg)

    check(res["validation"]["ok"], "EMF 结构校验通过 %s" % res["validation"]["issues"])
    check(not res["unknown_records"], "没有未知记录 %s" % res["unknown_records"])
    prims = res["primitives"]
    kinds = [p["kind"] for p in prims]
    for k in ("line", "polyline", "polygon", "bezier", "polypolyline", "ellipse", "rect", "roundrect", "arc",
              "chord", "pie", "text"):
        check(k in kinds, "图元种类 %s" % k)
    line = prims[0]
    check(line["kind"] == "line" and line["log"] == [[10, 20], [110, 220]], "MoveTo/LineTo 起止点 %s" % line["log"])
    check(line["pen"]["color"] == "#123456" and line["pen"]["width"] == 3, "笔颜色/宽度 %s" % line["pen"])
    poly = [p for p in prims if p["kind"] == "polygon"][0]
    check(poly["brush"]["color"] == "#aabbcc", "画刷颜色 %s" % poly["brush"])
    # 映射模式: 固定窗口原点/范围 -> 设备坐标
    mm = [p for p in prims if p["kind"] == "line"][1]
    check(mm["dev"] == [[1000.0, 2000.0], [1200.0, 2300.0]], "MM_ANISOTROPIC 设备坐标 %s" % mm["dev"])
    wt = [p for p in prims if p["kind"] == "line"][2]
    check(wt["dev"] == [[7.0, 10.0], [27.0, 40.0]], "世界变换后的坐标 %s" % wt["dev"])
    tx = [p for p in prims if p["kind"] == "text"][0]
    check(tx["text"] == "Hello中文"[:7] and tx["log"] == [[33, 44]] and tx["color"] == "#010203",
          "文字与参考点 %r %s %s" % (tx["text"], tx["log"], tx["color"]))
    names = res["record_counts"]
    for n in ("SAVEDC", "RESTOREDC", "INTERSECTCLIPRECT", "SETWORLDTRANSFORM", "SETMAPMODE", "SETWINDOWEXTEX",
              "SETVIEWPORTEXTEX", "EXTCREATEPEN", "CREATEBRUSHINDIRECT", "EXTTEXTOUTW"):
        check(n in names or n == "EXTCREATEPEN", "记录 %s 出现" % n)
    print("\n%d 项失败" % len(bad) if bad else "\n全部通过")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
