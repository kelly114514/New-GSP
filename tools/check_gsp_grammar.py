#!/usr/bin/env python3
"""检查 .gsp 语料是否符合 spec/format/gsp-format.md 描述的文法。

用法（只用标准库，建议带 -I）：

    python -I tools/check_gsp_grammar.py                      # 默认检查 original/sketchpad5 与 samples/baseline/samples
    python -I tools/check_gsp_grammar.py --root DIR           # 换语料根目录
    python -I tools/check_gsp_grammar.py --stats              # 额外打印按 kind 的统计表
    python -I tools/check_gsp_grammar.py --write-kinds spec/format/record-kinds.json

任何违例都会让进程以非零状态退出。--write-kinds 只用 --root 下的文件做统计（不含基准样本），
输出的键顺序固定、不含时间戳，因此同一语料得到同一份 JSON。

本脚本既是检查器，也是 record-kinds.json 的生成器：每个 kind 的名字、配对、成熟度和说明写在
KIND_INFO 里，出现次数、文件数、尺寸分布、出现位置由语料统计得出。
"""
from __future__ import annotations

import argparse
import json
import re
import struct
import sys
import zlib
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# --------------------------------------------------------------------------------------
# 一、kind 表（名字、配对、成熟度、说明）
# layout: known = 字节布局全部说明；partial = 部分字段已知；opaque = 只知道尺寸与位置
# --------------------------------------------------------------------------------------

BEGIN_END = {900: 901, 902: 903, 1000: 1001, 1002: 1003, 1004: 1005, 1006: 1007, 2000: 2007}
END_BEGIN = {v: k for k, v in BEGIN_END.items()}

# (kind, name, layout, notes)
_K = []


def k(kind, name, layout, notes):
    _K.append((kind, name, layout, notes))


k(900, "doc_begin", "known", "文档头，28 字节 = 14 个 u16，字段表见 §4。")
k(901, "doc_end", "known", "文档尾，空载荷；全文件最后一条记录，其后无字节。")
k(902, "compat_begin", "known",
  "兼容信封：16 字节头（8 个 u16）+ 3 个“u16 长度 + 字节 + NUL + 补齐到偶数”的提示串；恰含一个 1000、1002 或 1006。"
  "提示串写错会使原版崩溃。见 §5。")
k(903, "compat_end", "known", "兼容信封结尾，空载荷。")
k(1000, "page_begin", "partial",
  "页开始，36 字节：+24 = 页内 2000 个数〔已验证〕，+8 = 页标识〔推测〕，+4/+6 有符号 16 位偏移〔推测〕，+10/+16/+18 含义未明。见 §7.1。")
k(1001, "page_end", "known", "页结尾，空载荷。")
k(1002, "tool_begin", "partial", "自定义工具区开始，36 字节，布局同页头，+4..+11 恒为 0，+24 = 工具内对象数〔已验证〕。见 §7.1。")
k(1003, "tool_end", "known", "工具区结尾，空载荷。")
k(1004, "blob_begin", "opaque",
  "〔静态证据〕原版代码有、语料没有：类型 3 信封内的文档二进制块，载荷原样保存，其后跟 1005。")
k(1005, "blob_end", "opaque", "〔静态证据〕原版代码有、语料没有：与 1004 成对。")
k(1006, "extra_begin", "known", "文档附加信息组（仅布局 5；恰有一个，在第一个信封内），空载荷；内含 0..n 个 1300。见 §5.7。")
k(1007, "extra_end", "known", "附加信息组结尾，空载荷。")
k(1100, "section_name", "known", "页/工具名：NUL 结尾字符串，NUL 后 0 或 1 字节补齐（值不定，须保留）。见 §6、§7.3。")
k(1201, "font_entry", "partial",
  "字体条目：u16 属性字 + NUL 结尾字体名 + 0..3 字节残留（值不定，须保留）；同一容器内连续出现，1201 与 1203 同有同无。见 §7.4。")
k(1203, "text_style_entry", "partial",
  "文本样式条目，20 字节 = 10 个 u16；[0] = 本容器 1201 序号（0 起）〔已验证〕，[1] = 字号〔推测〕，其余未明。见 §7.4。")
k(1204, "tool_given_objects", "known",
  "工具已知对象表：u32 个数 + u32[个数]；值为本工具内对象序号（1 起），是 1..个数 的排列〔已验证〕。见 §7.9。")
k(1300, "embedded_image", "known", "嵌入图片：u32 宽、u32 高、完整 PNG（宽高与 IHDR 一致）；只出现在 1006 内。见 §5.7。")
k(2000, "object_begin", "known", "对象头：布局 5 为 28 字节，布局 4 为 16 字节；字段表见 §8.1。")
k(2002, "object_parents", "known",
  "父对象表：u32 个数 + u32[个数]，值为同容器内对象序号（1 起，且小于本对象序号）；约束非 0 的对象必有，约束为 0 的必无〔已验证〕。见 §8.2。")
k(2003, "object_constraint_extra", "partial",
  "约束附加参数；只出现在 25 种约束的对象上，多数以 u32 约束 ID 开头，其后随约束而变，内部未解码。须原样保留。见 §8.3。")
k(2005, "object_label", "partial",
  "标签记录：7 个 u16 + 8 字节 + u16 长度 + 标签文本 + NUL + 0..1 字节补齐；文本编码同全文件。见 §8.4。")
k(2007, "object_end", "known", "对象结尾，空载荷。")
k(2008, "object_text_style_ref", "known", "u16：本容器内 1203 条目序号（0 起）〔已验证〕。见 §8.5。")
k(2200, "object_rect_2200", "partial", "主类 0（文字）且约束为 0 的对象的位置框：4 个 i16〔推测为 左、上、右、下〕。见 §8.6。")
k(2201, "free_point_xy", "known", "自由点坐标：两个小端 IEEE-754 double（x、y）；当且仅当 约束=0 且 主类=1〔已验证〕。见 §8.6。")
k(2210, "object_rect_2210", "partial", "主类 10 且约束为 0 的对象的位置框：4 个 i16。见 §8.6。")
k(2211, "object_rect_2211", "partial", "主类 11 且约束为 0 的对象的位置框：4 个 i16。见 §8.6。")
k(2216, "object_picture_matrix", "partial",
  "主类 16（图片）且约束为 0 的对象：布局 5 为 6 个 f64〔观察到 a,0,tx,0,d,ty 形式的二维仿射矩阵，推测〕；布局 4 样本有 1 条 8 字节变体。见 §8.6。")
k(2300, "object_data_2300", "partial",
  "主类 0 的类专有数据，就是一个“文本块”：[u32=2300][u32 块长][u32=4][i16 x][i16 y][u16 n][n 字节][NUL][补齐]〔已验证〕。见 §8.7。")
k(2306, "object_data_2306", "opaque", "主类 6 的类专有数据；布局 4 为 32 字节，布局 5 为 40 字节；含 f64、整数和栈残留，未解码。见 §8.7。")
k(2307, "object_data_2307", "partial", "主类 7 的类专有数据：开头一个文本块（同 2300），其后 10 字节未解码。见 §8.7。")
k(2308, "object_data_2308", "opaque", "主类 8 的类专有数据；布局 5 为 8 字节，布局 4 为 2 字节。见 §8.7。")
k(2309, "object_data_2309", "opaque", "主类 9 的类专有数据；布局 5 为 4 字节，布局 4 为 2 字节。见 §8.7。")
k(2310, "object_data_2310", "partial", "主类 10 的类专有数据：自描述块 [u32=2310][u32=载荷长][u32=12] 后接数据，未解码。见 §8.7。")
k(2311, "object_data_2311", "partial",
  "主类 11 的类专有数据：开头一个文本块（同 2300），其后是内部块 [u32=2311]… 含表达式，并带栈残留，未解码；数量最多。见 §8.7。")
k(2314, "object_data_2314", "opaque", "主类 14 的类专有数据，24 字节，未解码。见 §8.7。")
k(2316, "object_picture_size", "partial", "主类 16（图片）的类专有数据：4 个 u32，观察到 (宽,高,宽,高) 形式的像素尺寸〔推测〕。见 §8.7。")
k(2317, "object_data_2317", "partial", "主类 17 的类专有数据：自描述块 [u32=2317][u32=载荷长][u32=16] 后接数据，未解码。见 §8.7。")
k(2318, "object_data_2318", "opaque", "主类 18 的类专有数据，12 字节（观察：u32、u32=0、COLORREF 0xFEFEFE）。见 §8.7。")
k(2319, "object_data_2319", "opaque", "主类 19 的类专有数据，16 字节（含一个 f64 的两半与若干 u16）。见 §8.7。")
for _i in range(2399, 2420):
    k(_i, "label_counter_%d" % (_i - 2400) if _i != 2399 else "label_counter_tail", "known",
      "页内自动标签计数器行：3 个 u16（前两个有效，第三个恒为 0）〔已验证〕。2400+i 对应外部主类 ID i〔静态证据〕，2399 是末项。"
      "布局 5 有 2400..2419，布局 4 只有 2400..2417。见 §7.5。")
k(8000, "object_emf", "partial", "主类 16 对象的 EMF 图元文件字节，语料仅 1 例（布局 4）。见 §8.8。")
k(8002, "object_dib", "opaque", "主类 16 对象的位图块，语料仅 1 例（布局 4）。见 §8.8。")
k(8004, "object_image_index", "known", "u16：本文档 1006 组内 1300 图片的序号（0 起）；仅主类 16 对象〔已验证〕。见 §8.8。")
k(9000, "page_object_list", "partial",
  "u32 数组，元素为页内对象序号（1 起）〔已验证〕；多数页只有一项且等于页内对象数。语义〔推测〕：存盘时的选中对象。见 §7.8。")
k(9004, "build_string", "known", "构建标记：NUL 结尾 ASCII，如 GSP5_w_1074K/Apr 19 2013；NUL 后 0..1 字节残留（值不定，须保留）。见 §7.6。")
k(9005, "page_coord_system_ref", "known",
  "u32 对象序号，指向页的坐标系对象（语料中恒为 约束61、主类8、genera39 的对象）〔已验证〕；原版读入时登记为页的特殊对象槽〔静态证据〕。见 §7.8。")
k(9006, "object_flag_9006", "known", "空载荷对象标记；原版读入时清除对象内部的一个标志〔静态证据〕，具体含义未明。见 §8.8。")
k(9007, "tool_description", "partial", "工具说明文字：NUL 结尾字符串，行尾为 CRLF〔已验证〕；NUL 后 0..1 字节残留。见 §7.10。")
k(9008, "page_dpi", "known", "u32，保存时的屏幕 DPI（观察到 96、72）；原版读入时忽略〔静态证据〕。见 §7.6。")
k(9009, "page_transform_entry", "partial", "页级自定义变换条目：u32、u32、u32=0、u32 名长 + UTF-8 名 + 恰 3 字节残留〔已验证〕；其余字段含义未明。见 §7.8。")
for _i, _n in ((10002, "flag_a"), (10003, "flag_b"), (10004, "flag_c"), (10005, "flag_d"), (10006, "flag_e"),
               (10007, "flag_f"), (10008, "flag_g")):
    k(_i, "page_pref_%s" % _n, "known", "页面偏好布尔值，2 字节（0/1）；偏好块第 %d 个布尔，含义未明。见 §7.7。" % (_i - 10001))
k(10020, "page_pref_color", "known", "页面偏好调色板条目：u16 序号 + R,G,B + 0；布局 5 共 15 条（序号 0..14），布局 4 共 12 条。见 §7.7。")
k(10021, "page_pref_10021", "known", "页面偏好整数，u16，原版读入时钳位到 ≤16；含义未明。见 §7.7。")
k(10022, "page_pref_10022", "known", "页面偏好布尔值，2 字节。见 §7.7。")
k(10023, "page_pref_10023", "known", "页面偏好布尔值，2 字节（仅布局 5）。见 §7.7。")
k(10040, "page_pref_slot", "known", "u16：低字节为值，高字节为槽号；每页恰 3 条，槽号依次 0、1、2。见 §7.7。")
k(10041, "page_pref_10041", "known", "页面偏好枚举，u16 ≤ 2〔疑为单位索引，推测〕。见 §7.7。")
k(10042, "page_pref_10042", "known", "页面偏好枚举，u16 ≤ 2。见 §7.7。")
k(10044, "page_pref_text_style", "partial",
  "默认文本样式行（仅布局 5，每页 6 条，序号 0..5）：u16 序号 + u16 残留 + 10 个 u16 样式字 + u16 + NUL 结尾字体名 + 残留。见 §7.7。")

KIND_INFO = {kind: (name, layout, notes) for kind, name, layout, notes in _K}

# 位置名
TOP, DOC, COMPAT, PAGE, TOOL, GROUP, OBJ_PAGE, OBJ_TOOL = (
    "top", "doc", "compat", "page", "tool", "group", "page>object", "tool>object")

# --------------------------------------------------------------------------------------
# 二、每个位置允许出现的 kind
# --------------------------------------------------------------------------------------
COUNTERS_5 = list(range(2400, 2420))
COUNTERS_4 = list(range(2400, 2418))
OBJ_KINDS = {2002, 2003, 2005, 2007, 2008, 2200, 2201, 2210, 2211, 2216,
             2300, 2306, 2307, 2308, 2309, 2310, 2311, 2314, 2316, 2317, 2318, 2319,
             8000, 8002, 8004, 9006}
PAGE_KINDS = ({1001, 1100, 1201, 1203, 2000, 2399, 9000, 9004, 9005, 9008, 9009,
               10002, 10003, 10004, 10005, 10006, 10007, 10008, 10020, 10021, 10022, 10023,
               10040, 10041, 10042, 10044} | set(COUNTERS_5))
TOOL_KINDS = {1003, 1100, 1201, 1203, 1204, 2000, 9007}
ALLOWED = {
    TOP: {900},
    DOC: {901, 902},
    COMPAT: {903, 1000, 1002, 1006},
    GROUP: {1007, 1300},
    PAGE: PAGE_KINDS,
    TOOL: TOOL_KINDS,
    OBJ_PAGE: OBJ_KINDS,
    OBJ_TOOL: OBJ_KINDS,
}

# 页内（1000 之内）出现的顺序模板：(kind, 最少, 最多或 None)
def page_template(layout):
    t = [(1100, 0, 1)]
    t += [(x, 1, 1) for x in (COUNTERS_5 if layout == 5 else COUNTERS_4)]
    t += [(2399, 1, 1), (9004, 1, 1), (9008, 1, 1), (1201, 0, None), (1203, 0, None)]
    if layout == 5:
        t += [(10002, 1, 1), (10003, 1, 1), (10004, 1, 1), (10005, 1, 1), (10006, 1, 1), (10007, 1, 1),
              (10020, 15, 15), (10021, 1, 1), (10022, 1, 1), (10023, 1, 1), (10008, 1, 1),
              (10040, 3, 3), (10041, 1, 1), (10042, 1, 1), (10044, 6, 6)]
    else:
        t += [(10002, 1, 1), (10003, 1, 1), (10004, 1, 1), (10020, 12, 12), (10021, 1, 1), (10022, 1, 1),
              (10040, 3, 3), (10041, 1, 1), (10042, 1, 1)]
    t += [(2000, 0, None), (9000, 0, 1), (9005, 0, 1), (9009, 0, None)]
    return t


TOOL_TEMPLATE = [(1100, 1, 1), (1201, 1, None), (1203, 1, None), (2000, 0, None), (1204, 1, 1), (9007, 0, 1)]

# 对象内子记录的固定次序（序号越小越靠前）
OBJ_RANK = {2002: 0, 2003: 1, 2005: 3, 2008: 4, 2200: 5, 2201: 5, 2210: 5, 2211: 5, 2216: 5,
            8000: 6, 8002: 7, 9006: 8, 8004: 9}
for _m in (0, 6, 7, 8, 9, 10, 11, 14, 16, 17, 18, 19):
    OBJ_RANK[2300 + _m] = 2
K23_MAIN = {0, 6, 7, 8, 9, 10, 11, 14, 16, 17, 18, 19}       # 带 23xx 的主类
K22_MAIN = {0, 1, 10, 11, 16}                                  # 约束为 0 时带 22xx 的主类
CONSTRAINTS_2003 = {15, 17, 18, 19, 21, 22, 23, 24, 27, 30, 52, 54, 55, 56, 62, 67, 68, 75, 96, 98, 99,
                    109, 110, 122, 123}
SIZE_2003 = {15: {12, 20}, 17: {52}, 18: {28}, 19: {28}, 21: {60}, 22: {28}, 23: {28}, 24: {36}, 27: {36},
             30: {12}, 52: {12}, 54: {12}, 55: {12}, 56: {12}, 67: {20}, 68: {20}, 75: {24}, 96: {12},
             98: {8}, 99: {28}, 109: {12}, 110: {12}, 122: {16}, 123: {12}}      # 62 的尺寸不定

# 固定尺寸：kind -> {布局: 允许的尺寸集合}；未列出表示尺寸不定
def _both(*s):
    return {4: set(s), 5: set(s)}


SIZE_RULES = {
    900: _both(28), 901: _both(0), 903: _both(0), 1000: _both(36), 1001: _both(0), 1002: _both(36),
    1003: _both(0), 1006: _both(0), 1007: _both(0), 1203: _both(20), 2000: {4: {16}, 5: {28}}, 2007: _both(0),
    2008: _both(2), 2200: _both(8), 2201: _both(16), 2210: _both(8), 2211: _both(8),
    2216: {4: {8}, 5: {48}},
    2306: {4: {32}, 5: {40}}, 2307: {4: {32, 36}, 5: {32, 40}}, 2308: {4: {2}, 5: {8}}, 2309: {4: {2}, 5: {4}},
    2314: _both(24), 2316: _both(16), 2318: {5: {12}}, 2319: {5: {16}},
    8004: {5: {2}}, 9004: {4: {24}, 5: {26}}, 9005: _both(4), 9006: _both(0), 9008: _both(4),
    10020: _both(6), 10021: _both(2), 10022: _both(2), 10040: _both(2), 10041: _both(2), 10042: _both(2),
}
for _i in range(10002, 10009):
    SIZE_RULES[_i] = _both(2)
SIZE_RULES[10023] = _both(2)
for _i in range(2399, 2420):
    SIZE_RULES[_i] = _both(6)

PNG_SIG = b"\x89PNG\r\n\x1a\n"
BUILD_RE = re.compile(rb"^GSP[45]_[WMwm]_\d{4}[A-Z]?/[A-Z][a-z]{2} [ \d]\d \d{4}$")

# --------------------------------------------------------------------------------------
# 三、记录遍历与树
# --------------------------------------------------------------------------------------


class Rec:
    __slots__ = ("kind", "off", "po", "size", "children", "parent", "end")

    def __init__(self, kind, off, po, size, parent):
        self.kind = kind
        self.off = off
        self.po = po
        self.size = size
        self.children = []
        self.parent = parent
        self.end = None


class FileCheck:
    def __init__(self, name, data, stats):
        self.name = name
        self.d = data
        self.v = []
        self.stats = stats
        self.layout = None

    def bad(self, off, msg):
        self.v.append("%s @0x%x: %s" % (self.name, off, msg))

    # ---- 容器层 ----
    def walk(self):
        d = self.d
        if len(d) < 12 or d[:4] != b"GSP4":
            self.bad(0, "魔数不是 GSP4 或文件过短")
            return None
        pos = 4
        recs = []
        while pos < len(d):
            if len(d) - pos < 8:
                self.bad(pos, "记录头不足 8 字节")
                return None
            size, kind = struct.unpack_from("<II", d, pos)
            end = pos + 8 + size
            if end > len(d):
                self.bad(pos, "载荷越过文件尾 kind=%d size=%d" % (kind, size))
                return None
            nxt = end + (end & 1)
            if nxt > len(d):
                self.bad(pos, "缺少补齐字节")
                return None
            if nxt != end and d[end] != 0:
                self.bad(end, "补齐字节不是 00")
            recs.append((kind, pos, pos + 8, size))
            pos = nxt
        if pos != len(d):
            self.bad(pos, "文件尾对不齐")
        return recs

    def build_tree(self, recs):
        root = Rec(0, 0, 0, 0, None)
        stack = [root]
        for kind, off, po, size in recs:
            top = stack[-1]
            if kind in END_BEGIN:
                if top.kind != END_BEGIN[kind]:
                    self.bad(off, "结束记录 %d 与当前开启的 %d 不配对" % (kind, top.kind))
                    return None
                top.end = off
                top.children.append(Rec(kind, off, po, size, top))
                stack.pop()
            elif kind in BEGIN_END:
                r = Rec(kind, off, po, size, top)
                top.children.append(r)
                stack.append(r)
            else:
                top.children.append(Rec(kind, off, po, size, top))
        if len(stack) != 1:
            self.bad(stack[-1].off, "容器 %d 未闭合" % stack[-1].kind)
            return None
        return root

    # ---- 统计 ----
    def note(self, r, ctx):
        s = self.stats
        s["occ"][r.kind] += 1
        s["files"][r.kind].add(self.name)
        s["sizes"][r.kind][r.size] += 1
        s["ctx"][r.kind][ctx] += 1
        s["layouts"][r.kind].add(self.layout)

    # ---- 辅助 ----
    def u16(self, off):
        return struct.unpack_from("<H", self.d, off)[0]

    def u32(self, off):
        return struct.unpack_from("<I", self.d, off)[0]

    def pl(self, r):
        return self.d[r.po:r.po + r.size]

    def text_ok(self, off, b, what, lenient4=False):
        """字符串编码：布局 5 严格 UTF-8；布局 4 为系统 ANSI（语料中为 GBK，另有一个 Big5 文件）。
        lenient4=True 时不检查布局 4 的多字节合法性（富文本块里有被截断的双字节字符）。"""
        if self.layout == 4 and lenient4:
            return
        if self.layout == 5:
            try:
                b.decode("utf-8")
            except UnicodeDecodeError:
                self.bad(off, "%s 不是合法 UTF-8" % what)
        else:
            for enc in ("gbk", "big5"):
                try:
                    b.decode(enc)
                    return
                except UnicodeDecodeError:
                    pass
            self.bad(off, "%s 既不是 GBK 也不是 Big5" % what)

    def cstring(self, r, start, what, allow_tail):
        """载荷 [start:] 为 NUL 结尾字符串，NUL 后至多 allow_tail 字节。返回字符串字节。"""
        b = self.pl(r)
        z = b.find(b"\0", start)
        if z < 0:
            self.bad(r.off, "%s 缺少 NUL" % what)
            return None
        if len(b) - z - 1 > allow_tail:
            self.bad(r.off, "%s NUL 之后有 %d 字节，超过 %d" % (what, len(b) - z - 1, allow_tail))
        return b[start:z]

    # ---- 文档层 ----
    def check(self):
        recs = self.walk()
        if recs is None:
            return
        if not recs or recs[0][0] != 900 or recs[0][3] != 28:
            self.bad(4, "第一条记录必须是 900 且 28 字节")
            return
        if recs[-1][0] != 901 or recs[-1][3] != 0:
            self.bad(recs[-1][1], "最后一条记录必须是空的 901")
        root = self.build_tree(recs)
        if root is None:
            return
        doc = root.children[0]
        if len(root.children) != 1 or doc.kind != 900:
            self.bad(0, "顶层只能有一个 900")
            return
        self.layout = self.u16(doc.po)
        if self.layout not in (4, 5):
            self.bad(doc.po, "布局版本 %r 不在 {4,5}" % self.layout)
            return
        self.check_children_allowed(doc, DOC)
        self.note(doc, TOP)
        f = struct.unpack_from("<14H", self.d, doc.po)
        envs = []
        kids = doc.children
        for c in kids:
            if c.kind == 902:
                envs.append(c)
        if kids[-1].kind != 901:
            self.bad(kids[-1].off, "900 内最后一项必须是 901")
        self.note(kids[-1], DOC)
        # 信封与内容
        types = []
        for e in envs:
            t = self.check_envelope(e)
            types.append(t)
        # 顺序：[组] 页* 工具*
        expect = ([5] if self.layout == 5 else []) + [1] * f[1] + [2] * f[2]
        if types != expect:
            self.bad(doc.off, "信封类型序列 %s 不是 %s" % (_rle(types), _rle(expect)))
        n902 = len(envs)
        # 文档头
        if f[3] != 0 or f[4] != 0 or f[5] != 0 or f[13] != 0:
            self.bad(doc.po, "900 头保留字段非 0: %r" % (f,))
        if f[6] not in (0, 1):
            self.bad(doc.po, "f[6] 不是 0/1")
        if f[7] != 4:
            self.bad(doc.po, "f[7] 不是 4")
        if f[1] < 1:
            self.bad(doc.po, "页数为 0")
        if not (f[8] < f[1]):
            self.bad(doc.po, "当前页序号 f[8]=%d 不小于页数 %d" % (f[8], f[1]))
        if f[9] < 50 or f[10] < 50:
            self.bad(doc.po, "窗口尺寸字段小于 50")
        if f[11] != (9 if self.layout == 5 else 3):
            self.bad(doc.po, "f[11]=%d 与布局不符" % f[11])
        if f[12] != (n902 if self.layout == 5 else 0):
            self.bad(doc.po, "f[12]=%d 应为 %d" % (f[12], n902 if self.layout == 5 else 0))
        # 页标识唯一
        ids = []
        for e in envs:
            for c in e.children:
                if c.kind == 1000:
                    ids.append(self.u16(c.po + 8))
        if len(set(ids)) != len(ids):
            self.bad(doc.off, "页标识重复")
        # 图片数（8004 索引上限）
        n1300 = 0
        for e in envs:
            for c in e.children:
                if c.kind == 1006:
                    n1300 = sum(1 for x in c.children if x.kind == 1300)
        self.n1300 = n1300
        for e in envs:
            for c in e.children:
                if c.kind == 1000:
                    self.check_page(c)
                elif c.kind == 1002:
                    self.check_tool(c)
                elif c.kind == 1006:
                    self.check_group(c)

    def check_children_allowed(self, node, ctx):
        allowed = ALLOWED[ctx]
        for c in node.children:
            if c.kind not in allowed:
                self.bad(c.off, "kind %d 不允许出现在 %s 内" % (c.kind, ctx))

    # ---- 902 ----
    def check_envelope(self, e):
        self.note(e, DOC)
        d = self.d
        pl = self.pl(e)
        t = -1
        if e.size < 16 + 12:
            self.bad(e.off, "902 载荷过短")
            return t
        h = struct.unpack_from("<8H", pl, 0)
        t = h[0]
        self.check_children_allowed(e, COMPAT)
        inner = [c for c in e.children if c.kind not in (903,)]
        if len(inner) != 1:
            self.bad(e.off, "902 内必须恰好一个内容容器，实际 %d" % len(inner))
        else:
            want = {5: 1006, 1: 1000, 2: 1002}.get(t)
            if inner[0].kind != want:
                self.bad(e.off, "902 类型 %d 与内容 %d 不符" % (t, inner[0].kind))
        if e.children[-1].kind != 903:
            self.bad(e.off, "902 必须以 903 结尾")
        else:
            self.note(e.children[-1], COMPAT)
        # 头字段
        v = 5 if t == 5 else 4
        if not (h[1] == v and h[2] == v):
            self.bad(e.off, "902 头 u16[1],u16[2] 应为 %d: %r" % (v, h))
        if h[3] != h[4]:
            self.bad(e.off, "902 头 u16[3] != u16[4]")
        if t == 1 and h[3] not in (1, 3):
            self.bad(e.off, "页信封 u16[3] 不在 {1,3}")
        if t in (2, 5) and h[3] != 3:
            self.bad(e.off, "非页信封 u16[3] 应为 3")
        if h[5] != {1: 2, 2: 4, 5: 4}.get(t):
            self.bad(e.off, "902 头 u16[5] 不符: %r" % (h,))
        if h[6] != 0 or h[7] != 0:
            self.bad(e.off, "902 头 u16[6],u16[7] 应为 0")
        # 三个提示串
        pos = 16
        strs = []
        for i in range(3):
            if pos + 2 > len(pl):
                self.bad(e.off, "提示串 %d 越界" % i)
                return t
            n = struct.unpack_from("<H", pl, pos)[0]
            end = pos + 2 + n
            if end >= len(pl) or pl[end] != 0:
                self.bad(e.off, "提示串 %d 长度 %d 与 NUL 位置不符" % (i, n))
                return t
            s = pl[pos + 2:end]
            if b"\0" in s:
                self.bad(e.off, "提示串 %d 含内嵌 NUL" % i)
            self.text_ok(e.po + pos, s, "提示串 %d" % i)
            strs.append(s)
            nxt = end + 1
            nxt += nxt & 1
            if i < 2 and nxt >= len(pl):
                self.bad(e.off, "提示串 %d 之后没有下一个串（原版会越界读取）" % i)
                return t
            pos = nxt
        if pos != len(pl):
            self.bad(e.off, "提示串之后多出 %d 字节" % (len(pl) - pos))
        if t in (1, 2, 5) and h[3] and not strs[1]:
            self.bad(e.off, "第二提示串为空")
        if t in (1, 2) and strs[0]:
            self.bad(e.off, "页/工具信封的第一提示串应为空")
        if t == 1:
            pages_only = sum(1 for x in e.parent.children if x.kind == 902 and self.u16(x.po) == 1)
            tools_n = sum(1 for x in e.parent.children if x.kind == 902 and self.u16(x.po) == 2)
            want = 1 if (pages_only == 1 and tools_n == 0) else 3
            if h[3] != want:
                self.bad(e.off, "页信封 u16[3]=%d，按“单页无工具→1，否则→3”应为 %d" % (h[3], want))
        return t

    # ---- 1006 ----
    def check_group(self, g):
        self.note(g, COMPAT)
        if self.layout != 5:
            self.bad(g.off, "布局 4 不应有 1006")
        self.check_children_allowed(g, GROUP)
        if g.children[-1].kind != 1007:
            self.bad(g.off, "1006 必须以 1007 结尾")
        else:
            self.note(g.children[-1], GROUP)
        for c in g.children:
            if c.kind == 1300:
                self.note(c, GROUP)
                self.check_png(c)

    def check_png(self, c):
        b = self.pl(c)
        if len(b) < 8 + 8 + 33 + 12 or b[8:16] != PNG_SIG:
            self.bad(c.off, "1300 不是 u32 宽 + u32 高 + PNG")
            return
        w, h = struct.unpack_from("<II", b, 0)
        pos = 16
        first = True
        ok = False
        while pos + 12 <= len(b):
            ln = struct.unpack_from(">I", b, pos)[0]
            typ = b[pos + 4:pos + 8]
            if pos + 12 + ln > len(b):
                self.bad(c.off, "PNG 块越界")
                return
            if zlib.crc32(b[pos + 4:pos + 8 + ln]) & 0xFFFFFFFF != struct.unpack_from(">I", b, pos + 8 + ln)[0]:
                self.bad(c.off, "PNG CRC 错误 (%r)" % typ)
                return
            if first:
                first = False
                if typ != b"IHDR" or ln != 13:
                    self.bad(c.off, "PNG 首块不是 IHDR")
                    return
                if struct.unpack_from(">II", b, pos + 8)[0:2] != (w, h):
                    self.bad(c.off, "1300 宽高与 IHDR 不符")
            pos += 12 + ln
            if typ == b"IEND":
                ok = True
                break
        if not ok or pos != len(b):
            self.bad(c.off, "PNG 未恰好结束于载荷末尾")

    # ---- 页 / 工具 ----
    def match_template(self, node, template, what):
        seq = [c for c in node.children if c.kind not in (1001, 1003)]
        i = 0
        for kind, lo, hi in template:
            n = 0
            while i < len(seq) and seq[i].kind == kind and (hi is None or n < hi):
                n += 1
                i += 1
            if n < lo:
                self.bad(node.off, "%s: kind %d 出现 %d 次，应至少 %d 次（顺序或缺失）" % (what, kind, n, lo))
                return False
        if i != len(seq):
            self.bad(seq[i].off, "%s: kind %d 出现位置/次数不符合模板" % (what, seq[i].kind))
            return False
        return True

    def check_header36(self, c, is_page):
        b = self.pl(c)
        u = struct.unpack_from("<18H", b, 0)
        n = struct.unpack_from("<I", b, 24)[0]
        nobj = sum(1 for x in c.children if x.kind == 2000)
        if n != nobj:
            self.bad(c.off, "对象数字段 %d 与实际 %d 不符" % (n, nobj))
        for i in (0, 1, 6, 7, 10, 11, 13, 14, 15, 16, 17):
            if u[i] != 0:
                self.bad(c.off, "36 字节头 u16[%d] 应为 0" % i)
        if u[5] not in (0, 1):
            self.bad(c.off, "36 字节头 u16[5] 不是 0/1")
        if u[8] not in (0, 1, 2) or u[9] not in (0, 1, 2):
            self.bad(c.off, "36 字节头 u16[8]/u16[9] 不在 0..2")
        if is_page:
            if u[4] < 0x8000:
                self.bad(c.off, "页标识 %d 小于 0x8000" % u[4])
        else:
            if any(u[i] for i in (2, 3, 4, 5)):
                self.bad(c.off, "工具头 +4..+11 应为 0")

    def check_page(self, p):
        self.note(p, COMPAT)
        self.check_children_allowed(p, PAGE)
        if p.children[-1].kind != 1001:
            self.bad(p.off, "页必须以 1001 结尾")
        else:
            self.note(p.children[-1], PAGE)
        self.check_header36(p, True)
        self.match_template(p, page_template(self.layout), "页")
        self.check_container_records(p, PAGE, OBJ_PAGE)

    def check_tool(self, t):
        self.note(t, COMPAT)
        self.check_children_allowed(t, TOOL)
        if t.children[-1].kind != 1003:
            self.bad(t.off, "工具区必须以 1003 结尾")
        else:
            self.note(t.children[-1], TOOL)
        self.check_header36(t, False)
        self.match_template(t, TOOL_TEMPLATE, "工具区")
        self.check_container_records(t, TOOL, OBJ_TOOL)

    def check_container_records(self, cont, ctx, octx):
        """逐条检查容器内记录（尺寸、字段）与其中的对象。"""
        L = self.layout
        n1201 = n1203 = 0
        objs = [c for c in cont.children if c.kind == 2000]
        nobj = len(objs)
        for c in cont.children:
            k_ = c.kind
            if k_ in (1001, 1003):
                continue
            if k_ != 2000:
                self.note(c, ctx)
                self.check_size(c)
            if k_ == 1201:
                n1201 += 1
            elif k_ == 1203:
                n1203 += 1
        # 1100/1201/1203 内容
        i20 = []
        i44 = []
        i40 = []
        for c in cont.children:
            k_ = c.kind
            b = self.pl(c) if c.size < 100000 else b""
            if k_ == 1100:
                s = self.cstring(c, 0, "1100", 1)
                if s is not None:
                    if c.size != (len(s) + 2) & ~1:
                        self.bad(c.off, "1100 载荷长度应为 (strlen+2)&~1")
                    self.text_ok(c.po, s, "1100")
            elif k_ == 1201:
                if c.size < 4 or c.size & 1:
                    self.bad(c.off, "1201 尺寸异常")
                s = self.cstring(c, 2, "1201", 3)
                if s is not None:
                    self.text_ok(c.po, s, "1201 字体名")
            elif k_ == 1203:
                w = struct.unpack_from("<10H", b, 0)
                if w[0] >= n1201:
                    self.bad(c.off, "1203 字体序号越界")
                if any(x not in (1, 2) for x in w[2:5]) or w[5] not in (1, 3) or w[6] != 1:
                    self.bad(c.off, "1203 样式字 [2..6] 超出观察范围: %r" % (w,))
            elif k_ == 1204:
                cnt = struct.unpack_from("<I", b, 0)[0]
                if c.size != 4 + 4 * cnt or cnt < 1:
                    self.bad(c.off, "1204 长度/个数不符")
                else:
                    vals = struct.unpack_from("<%dI" % cnt, b, 4)
                    if sorted(vals) != list(range(1, cnt + 1)):
                        self.bad(c.off, "1204 不是 1..%d 的排列" % cnt)
                    if cnt > nobj:
                        self.bad(c.off, "1204 个数大于对象数")
            elif k_ == 9000:
                if c.size % 4 or c.size < 4:
                    self.bad(c.off, "9000 长度不是 4 的正整数倍")
                else:
                    for v in struct.unpack_from("<%dI" % (c.size // 4), b, 0):
                        if not 1 <= v <= nobj:
                            self.bad(c.off, "9000 对象序号 %d 越界" % v)
            elif k_ == 9004:
                s = self.cstring(c, 0, "9004", 1)
                if s is not None and not BUILD_RE.match(s):
                    self.bad(c.off, "9004 构建串格式异常: %r" % s)
            elif k_ == 9005:
                v = struct.unpack_from("<I", b, 0)[0]
                if not 1 <= v <= nobj:
                    self.bad(c.off, "9005 对象序号越界")
                else:
                    tgt = objs[v - 1]
                    con, mk = self.u16(tgt.po), self.u16(tgt.po + 6)
                    if (con, mk) != (61, 8):
                        self.bad(c.off, "9005 目标对象不是 约束61/主类8")
            elif k_ == 9007:
                s = self.cstring(c, 0, "9007", 1)
                if s is not None:
                    self.text_ok(c.po, s, "9007")
                    if s.count(b"\r") != s.count(b"\n") or s.count(b"\r\n") != s.count(b"\n"):
                        self.bad(c.off, "9007 的换行不是 CRLF")
            elif k_ == 9008:
                if self.u32(c.po) not in (72, 96):
                    self.bad(c.off, "9008 不是 72/96")
            elif k_ == 9009:
                ln = struct.unpack_from("<I", b, 12)[0]
                if struct.unpack_from("<I", b, 8)[0] != 0 or c.size != 16 + ln + 3:
                    self.bad(c.off, "9009 结构不符")
                else:
                    self.text_ok(c.po, b[16:16 + ln], "9009")
            elif 2399 <= k_ <= 2419:
                if struct.unpack_from("<H", b, 4)[0] != 0:
                    self.bad(c.off, "%d 第三个 u16 非 0" % k_)
            elif 10002 <= k_ <= 10008 or k_ in (10022, 10023):
                if struct.unpack_from("<H", b, 0)[0] not in (0, 1):
                    self.bad(c.off, "%d 不是 0/1" % k_)
            elif k_ == 10020:
                i20.append(struct.unpack_from("<H", b, 0)[0])
                if L == 5 and b[5] != 0:
                    self.bad(c.off, "10020 末字节非 0")
            elif k_ == 10021:
                if struct.unpack_from("<H", b, 0)[0] > 16:
                    self.bad(c.off, "10021 大于 16")
            elif k_ == 10040:
                i40.append(b[1])
            elif k_ in (10041, 10042):
                if struct.unpack_from("<H", b, 0)[0] > 2:
                    self.bad(c.off, "%d 大于 2" % k_)
            elif k_ == 10044:
                i44.append(self.u16(c.po))
                s = self.cstring(c, 26, "10044", 8) if c.size > 26 else None
                if s is None:
                    self.bad(c.off, "10044 过短")
                else:
                    self.text_ok(c.po, s, "10044 字体名")
        if ctx == PAGE:
            if i20 != list(range(15 if L == 5 else 12)):
                self.bad(cont.off, "10020 序号序列不是 0..%d" % (14 if L == 5 else 11))
            if i40 != [0, 1, 2]:
                self.bad(cont.off, "10040 槽号序列不是 0,1,2")
            if L == 5 and i44 != list(range(6)):
                self.bad(cont.off, "10044 序号序列不是 0..5")
        if (n1201 > 0) != (n1203 > 0):
            self.bad(cont.off, "1201 与 1203 应同时存在或同时缺失")
        # 对象
        for idx, o in enumerate(objs, 1):
            self.check_object(o, idx, octx, n1203, cont)

    def check_size(self, r):
        rule = SIZE_RULES.get(r.kind)
        if rule is None:
            return
        allowed = rule.get(self.layout)
        if allowed is None:
            self.bad(r.off, "kind %d 不应出现在布局 %d" % (r.kind, self.layout))
        elif r.size not in allowed:
            self.bad(r.off, "kind %d 尺寸 %d 不在 %s" % (r.kind, r.size, sorted(allowed)))

    # ---- 对象 ----
    def check_object(self, o, idx, octx, n1203, cont):
        L = self.layout
        self.note(o, PAGE if octx == OBJ_PAGE else TOOL)
        self.check_size(o)
        self.check_children_allowed(o, octx)
        if o.children[-1].kind != 2007:
            self.bad(o.off, "对象必须以 2007 结尾")
        else:
            self.note(o.children[-1], octx)
        b = self.pl(o)
        con, f08, f04, mk, ge, st = struct.unpack_from("<6H", b, 0)
        if con >= 128:
            self.bad(o.off, "约束外部 ID %d ≥ 128" % con)
        if f08 > 4:
            self.bad(o.off, "对象状态码 %d > 4" % f08)
        if f04 > 1:
            self.bad(o.off, "+4 字段 %d > 1" % f04)
        if mk > 19:
            self.bad(o.off, "主类 ID %d > 19" % mk)
        if ge >= 100:
            self.bad(o.off, "genera ID %d ≥ 100" % ge)
        if L == 5:
            if st >> 12:
                self.bad(o.off, "样式字高 4 位非 0")
            w0, w1, w2 = st & 15, (st >> 4) & 15, (st >> 8) & 15
            if w0 > 3 or w1 > 2 or w2 > 3:
                self.bad(o.off, "样式字超出夹取范围 %r" % ((w0, w1, w2),))
            if b[15] != 0:
                self.bad(o.off, "颜色字之后的 +0x0F 应为 0")
            if struct.unpack_from("<I", b, 24)[0] > 1:
                self.bad(o.off, "+0x18 字段大于 1")
        else:
            if st > 2:
                self.bad(o.off, "布局 4 样式枚举 %d > 2" % st)
        kids = [c for c in o.children if c.kind != 2007]
        ranks = []
        kinds = [c.kind for c in kids]
        for c in kids:
            self.note(c, octx)
            self.check_size(c)
            r = OBJ_RANK.get(c.kind)
            if r is None:
                self.bad(c.off, "对象内出现未登记 kind %d" % c.kind)
                continue
            ranks.append(r)
        if ranks != sorted(ranks):
            self.bad(o.off, "对象内子记录次序错误: %r" % kinds)
        if len(set(kinds)) != len(kinds):
            self.bad(o.off, "对象内子记录重复: %r" % kinds)
        # 约束与父表
        if (con != 0) != (2002 in kinds):
            self.bad(o.off, "2002 存在性与约束 %d 不符" % con)
        if con in CONSTRAINTS_2003 and con not in (15, 62) and 2003 not in kinds:
            self.bad(o.off, "约束 %d 必须带 2003" % con)
        for c in kids:
            if c.kind == 2002:
                cnt = self.u32(c.po)
                if c.size != 4 + 4 * cnt or cnt < 1:
                    self.bad(c.off, "2002 长度规则不成立")
                else:
                    for v in struct.unpack_from("<%dI" % cnt, self.d, c.po + 4):
                        if not 1 <= v < idx:
                            self.bad(c.off, "父序号 %d 不在 [1,%d]" % (v, idx - 1))
            elif c.kind == 2003:
                if con not in CONSTRAINTS_2003:
                    self.bad(c.off, "约束 %d 不应有 2003" % con)
                elif con in SIZE_2003 and c.size not in SIZE_2003[con]:
                    self.bad(c.off, "约束 %d 的 2003 尺寸 %d 不在 %s" % (con, c.size, sorted(SIZE_2003[con])))
            elif c.kind == 2005:
                f5 = struct.unpack_from("<7H", self.d, c.po)
                if f5[0] not in (3, 4, 6, 7) or f5[1] > 1 or f5[2] > 1 or f5[5] or f5[6]:
                    self.bad(c.off, "2005 前 7 个 u16 超出观察范围: %r" % (f5,))
                ln = self.u16(c.po + 22)
                if c.size not in (24 + ln + 1, 24 + ln + 2) or c.size & 1 or self.d[c.po + 24 + ln] != 0:
                    self.bad(c.off, "2005 结构不符")
                else:
                    self.text_ok(c.po, self.d[c.po + 24:c.po + 24 + ln], "2005 标签")
            elif c.kind in (2300, 2307, 2311):
                # 文本块：[u32=2300][u32 块长][u32=4][i16 x][i16 y][u16 n][n 字节][NUL][补齐到偶数]
                tb = self.pl(c)
                u0, u1, u2 = struct.unpack_from("<3I", tb, 0)
                n = struct.unpack_from("<H", tb, 16)[0]
                if (u0 != 2300 or u2 != 4 or 18 + n >= len(tb) or tb[18 + n] != 0
                        or u1 != (n + 20) & ~1 or u1 > len(tb)):
                    self.bad(c.off, "%d 开头不是合法文本块" % c.kind)
                else:
                    self.text_ok(c.po, tb[18:18 + n], "%d 文本块" % c.kind, lenient4=True)
                    if c.kind == 2300 and len(tb) - u1 not in (0, 2):
                        self.bad(c.off, "2300 文本块之后应有 0 或 2 字节")
            elif c.kind in (2310, 2317):
                tb = self.pl(c)
                u0, u1, u2 = struct.unpack_from("<3I", tb, 0)
                if u0 != c.kind or u1 != len(tb) or u2 != (12 if c.kind == 2310 else 16):
                    self.bad(c.off, "%d 自描述块头不符" % c.kind)
            elif c.kind == 2008:
                if self.u16(c.po) >= n1203:
                    self.bad(c.off, "2008 样式序号越界")
            elif c.kind == 8004:
                if mk != 16 or self.u16(c.po) >= self.n1300:
                    self.bad(c.off, "8004 仅限主类16且序号小于 1300 个数")
            elif c.kind in (8000, 8002):
                if mk != 16:
                    self.bad(c.off, "%d 仅限主类 16" % c.kind)
        if (mk in K23_MAIN) != ((2300 + mk) in kinds):
            self.bad(o.off, "主类 %d 的 23xx 存在性不符" % mk)
        for kk in kinds:
            if 2300 <= kk <= 2319 and kk != 2300 + mk:
                self.bad(o.off, "主类 %d 带了 %d" % (mk, kk))
        want22 = (con == 0 and mk in K22_MAIN)
        for kk in kinds:
            if 2200 <= kk <= 2219 and not (want22 and kk == 2200 + mk):
                self.bad(o.off, "不应出现的 %d (约束 %d 主类 %d)" % (kk, con, mk))
        if want22 and (2200 + mk) not in kinds:
            self.bad(o.off, "缺少 %d (约束0主类%d)" % (2200 + mk, mk))
        if con == 0 and mk not in K22_MAIN:
            self.bad(o.off, "约束为 0 的对象主类 %d 不在 {0,1,10,11,16}" % mk)
        if (mk == 1 and con == 0) != (2201 in kinds):
            self.bad(o.off, "2201 存在性不符")


def _rle(seq):
    out = []
    for x in seq:
        if out and out[-1][0] == x:
            out[-1][1] += 1
        else:
            out.append([x, 1])
    return ",".join("%s×%d" % (a, b) if b > 1 else str(a) for a, b in out)


# --------------------------------------------------------------------------------------
# 四、入口
# --------------------------------------------------------------------------------------


def new_stats():
    return {"occ": Counter(), "files": defaultdict(set), "sizes": defaultdict(Counter),
            "ctx": defaultdict(Counter), "layouts": defaultdict(set)}


def collect(root: Path):
    return sorted((p for p in root.rglob("*") if p.is_file() and p.suffix.lower() == ".gsp"),
                  key=lambda p: p.relative_to(root).as_posix())


def run(paths, root, stats, limit):
    nrec = 0
    bad = []
    for p in paths:
        data = p.read_bytes()
        name = p.relative_to(root).as_posix()
        fc = FileCheck(name, data, stats)
        try:
            fc.check()
        except Exception as ex:  # 检查器自身对异常结构的兜底
            fc.v.append("%s: 检查时异常 %s: %s" % (name, type(ex).__name__, ex))
        nrec += sum(1 for _ in _count(data))
        bad.extend(fc.v)
    return nrec, bad


def _count(data):
    pos = 4
    while pos + 8 <= len(data):
        size = struct.unpack_from("<I", data, pos)[0]
        yield pos
        pos += 8 + size + (size & 1)


CTX_ORDER = [TOP, DOC, COMPAT, GROUP, PAGE, TOOL, OBJ_PAGE, OBJ_TOOL]

# 成熟度为 known 的 kind 里仍含“残留字节”的，写明哪些字节要原样保留；
# partial / opaque 的 kind 一律整条载荷原样保留。
RESIDUE = {
    900: "整头原样保留（[6]、[9]、[10] 等含义未明）",
    902: "每个提示串之后的补齐字节（值不定）",
    1000: "头中未解码的字段 +4、+6、+8、+10、+16、+18",
    1002: "头中未解码的字段 +16、+18",
    1100: "NUL 之后的 0..1 个残留字节",
    9004: "NUL 之后的 0..1 个残留字节",
    2000: "布局 5 的 +18..+19；布局 4 的 +15；以及未解码的状态码/field04/排序值/+24",
    10020: "布局 4 的最后 1 个字节",
}


def verbatim_note(kind, layout, size_hint):
    if layout in ("partial", "opaque"):
        return "整条载荷逐字节原样保留"
    if kind in RESIDUE:
        return RESIDUE[kind]
    if kind in END_BEGIN or kind in (1006,):
        return "空载荷"
    return "载荷已完全解码；仍按原字节保存"


def kinds_json(stats, nfiles):
    out = []
    all_kinds = sorted(set(KIND_INFO) | set(stats["occ"]))
    for kind in all_kinds:
        name, layout, notes = KIND_INFO.get(kind, ("kind_%d" % kind, "opaque", "未登记"))
        pair = BEGIN_END.get(kind) or END_BEGIN.get(kind)
        sizes = stats["sizes"].get(kind, Counter())
        top = sorted(sizes.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
        ctxs = stats["ctx"].get(kind, Counter())
        out.append({
            "kind": kind,
            "name": name,
            "pair": pair if kind in BEGIN_END else None,
            "closes": END_BEGIN.get(kind),
            "layout": layout,
            "contexts": [c for c in CTX_ORDER if c in ctxs],
            "occurrences": stats["occ"].get(kind, 0),
            "files": len(stats["files"].get(kind, ())),
            "layout_versions": sorted(stats["layouts"].get(kind, ())),
            "payload_sizes": {str(s_): n for s_, n in top},
            "distinct_sizes": len(sizes),
            "preserve_verbatim": verbatim_note(kind, layout, sizes),
            "notes": notes,
        })
    return {
        "generated_by": "tools/check_gsp_grammar.py --write-kinds",
        "corpus_files": nfiles,
        "contexts_legend": {
            "top": "文件最外层（只有 900）",
            "doc": "900 之内",
            "compat": "902 之内",
            "group": "1006 之内",
            "page": "1000 之内",
            "tool": "1002 之内",
            "page>object": "页里的 2000 之内",
            "tool>object": "工具区里的 2000 之内",
        },
        "layout_legend": {
            "known": "载荷字节布局全部清楚（残留字节另见 preserve_verbatim）",
            "partial": "部分字段已解码，其余未知；整条载荷逐字节保留",
            "opaque": "只知道位置与尺寸；整条载荷逐字节保留",
        },
        "kinds": out,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", type=Path, default=REPO / "original" / "sketchpad5")
    ap.add_argument("--samples", type=Path, default=REPO / "samples" / "baseline" / "samples",
                    help="额外检查的基准样本目录（不存在则跳过；传空串可关闭）")
    ap.add_argument("--stats", action="store_true", help="打印按 kind 的统计")
    ap.add_argument("--write-kinds", type=Path, help="把 kind 表写成 JSON")
    ap.add_argument("--limit", type=int, default=40, help="最多打印多少条违例")
    args = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass

    root = args.root if args.root.is_absolute() else (Path.cwd() / args.root)
    if not root.is_dir():
        print("语料目录不存在: %s" % root)
        return 2
    files = collect(root)
    stats = new_stats()
    nrec, bad = run(files, root, stats, args.limit)
    nsamp = nsrec = 0
    sample_dir = args.samples
    if str(sample_dir) not in ("", ".") and sample_dir.is_dir():
        sfiles = collect(sample_dir)
        nsamp = len(sfiles)
        nsrec, sbad = run(sfiles, sample_dir, new_stats(), args.limit)
        bad.extend("[基准样本] " + s for s in sbad)

    print("语料: %s" % root)
    print("文件: %d  记录: %d  kind 种数: %d" % (len(files), nrec, len(stats["occ"])))
    if nsamp:
        print("基准样本: %d 个文件, %d 条记录" % (nsamp, nsrec))
    if args.stats:
        print("%-6s %-24s %10s %6s  %s" % ("kind", "name", "records", "files", "contexts"))
        for kind in sorted(stats["occ"]):
            name = KIND_INFO.get(kind, ("?",))[0]
            ctxs = [c for c in CTX_ORDER if c in stats["ctx"][kind]]
            print("%-6d %-24s %10d %6d  %s" % (kind, name, stats["occ"][kind], len(stats["files"][kind]), ",".join(ctxs)))
    missing = sorted(set(stats["occ"]) - set(KIND_INFO))
    if missing:
        bad.append("语料中有未登记的 kind: %r" % missing)
    if args.write_kinds:
        args.write_kinds.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(kinds_json(stats, len(files)), ensure_ascii=False, indent=1)
        args.write_kinds.write_text(text + "\n", encoding="utf-8", newline="\n")
        print("已写出 %s" % args.write_kinds)
    print("违例: %d" % len(bad))
    for s in bad[:args.limit]:
        print("  " + s)
    if len(bad) > args.limit:
        print("  ... 另有 %d 条" % (len(bad) - args.limit))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
