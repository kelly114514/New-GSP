#!/usr/bin/env python3
"""Offline measurement record decoder and original-EMF value extraction.
No formula evaluator is used to create expected values. Unknown layouts fail closed.
"""
from collections import Counter
import math
import re
import struct

MEASURES = set(range(36, 49)) | {65, 66, 86, 94}
FUNCTIONS = dict(enumerate(("sin", "cos", "tan", "asin", "acos", "atan", "abs", "sqrt", "ln", "log", "sgn", "round", "trunc")))
OPERATORS = {0x1000: "+", 0x1001: "-", 0x1002: "*", 0x1003: "/", 0x1004: "^"}
UNITS = {0x100: "rad", 0x101: "deg", 0x201: "cm"}


def record_fields(raw, kind):
    """Only the observed <0> template and expression block with marker word 4."""
    if kind not in (2307, 2311) or kind == 2307 and len(raw) != 32:
        return None
    if len(raw) < 32 or raw[16:22] != b"\x03\x00<0>\x00":
        return None
    result = {"position": list(struct.unpack_from("<hh", raw, 12)),
              "formatWords": list(struct.unpack_from("<4H", raw, 24))}
    if kind == 2311:
        if len(raw) < 92 or (len(raw) - 92) % 2:
            return None
        size, header = struct.unpack_from("<2I", raw, 36)
        # Header has two u16 fields at +44/+46, not a u32 token count.
        count, marker = struct.unpack_from("<2H", raw, 44)
        if struct.unpack_from("<I", raw, 32)[0] != 2311 or size != len(raw) - 32 or header != 48 or marker != 4 or len(raw) != 92 + count * 2:
            return None
        result["tokens"] = list(struct.unpack_from("<" + "H" * count, raw, 92))
    return result


def token_text(tokens, parent_count):
    """Readable native INFIX token sequence; rejects unknown tags or parent slots.
    Function tokens include the opening parenthesis; token 12 closes it.
    This is diagnostic text, not executable Python or JavaScript.
    """
    out = []
    for t in tokens:
        if 0 <= t <= 9:
            out.append(str(t))
        elif t in (10, 11, 12, 13, 14):
            out.append({10: ".", 11: "(", 12: ")", 13: "pi", 14: "e"}[t])
        elif t in OPERATORS:
            out.append(OPERATORS[t])
        elif 0x2000 <= t <= 0x200c:
            out.append(FUNCTIONS[t - 0x2000] + "(")
        elif 0x6000 <= t < 0x6000 + parent_count:
            out.append("parent[" + str(t - 0x6000) + "]")
        elif t in UNITS:
            out.append(" " + UNITS[t] + " ")
        else:
            raise ValueError("unverified native expression token " + hex(t))
    return "".join(out)


def expression_tree(tokens, parent_count):
    """Decode the verified native infix subset for STRUCTURAL HTML cross-checks.
    This result never supplies expected geometry or measurements.
    """
    at = 0
    def parse(minimum=0):
        nonlocal at
        if at >= len(tokens):
            raise ValueError("missing expression operand")
        t = tokens[at]
        at += 1
        if t in (0x1000, 0x1001):
            node = parse(25)
            if t == 0x1001:
                node = ("neg", node)
        elif t == 11 or 0x2000 <= t <= 0x200c or 0x7000 <= t < 0x7000 + parent_count:
            node = parse()
            if at >= len(tokens) or tokens[at] != 12:
                raise ValueError("unclosed expression group")
            at += 1
            if t != 11:
                node = (FUNCTIONS[t - 0x2000] if t < 0x7000 else "call:" + str(t - 0x7000), node)
        elif 0 <= t <= 10:
            digits = [t]
            while at < len(tokens) and 0 <= tokens[at] <= 10:
                digits.append(tokens[at]); at += 1
            node = ("number", float("".join("." if v == 10 else str(v) for v in digits)))
        elif t in (13, 14):
            node = ("number", math.pi if t == 13 else math.e)
        elif 0x6000 <= t < 0x6000 + parent_count:
            node = ("parent", t - 0x6000)
        else:
            raise ValueError("unverified native expression token " + hex(t))
        if at < len(tokens) and tokens[at] in UNITS:
            u = tokens[at]; at += 1
            factor = {0x100: 1, 0x101: math.pi / 180, 0x102: math.pi / 180,
                      0x200: 1, 0x201: 96 / 2.54, 0x202: 96}[u]
            if node[0] != "number":
                raise ValueError("nonliteral unit suffix is not yet verified")
            node = ("number", node[1] * factor)
        while at < len(tokens) and tokens[at] in OPERATORS:
            op = OPERATORS[tokens[at]]
            priority = {"+": 10, "-": 10, "*": 20, "/": 20, "^": 30}[op]
            if priority < minimum:
                break
            at += 1
            node = (op, node, parse(priority if op == "^" else priority + 1))
        return node
    tree = parse()
    if at != len(tokens):
        raise ValueError("unconsumed expression tokens")
    return tree


def html_expression_tree(rpn):
    stack = []
    funcs = {"@sin_": "sin", "@cos_": "cos", "@tan_": "tan", "@asin": "asin", "@acos": "acos", "@atan": "atan",
             "@abs_": "abs", "@sqrt": "sqrt", "@ln__": "ln", "@log_": "log", "@sgn_": "sgn", "@rond": "round", "@trnc": "trunc"}
    for token in rpn.split():
        if token in ("+", "-", "*", "/", "^"):
            right, left = stack.pop(), stack.pop()
            stack.append((token, left, right))
        elif token == "!" or token in funcs or re.fullmatch(r"@f[A-Z]", token):
            name = "neg" if token == "!" else funcs.get(token, "call:" + str(ord(token[-1]) - 65))
            stack.append((name, stack.pop()))
        elif re.fullmatch(r"[A-Z]", token):
            stack.append(("parent", ord(token) - 65))
        else:
            stack.append(("number", float(token)))
    if len(stack) != 1:
        raise ValueError("invalid HTML RPN stack")
    return stack[0]


def same_expression(a, b):
    if a[0] != b[0] or len(a) != len(b):
        return False
    if a[0] == "number":
        # HTML writes about six significant digits; this does not validate internal precision.
        return math.isclose(a[1], b[1], rel_tol=6e-6, abs_tol=1e-7)
    if a[0] == "parent":
        return a[1] == b[1]
    return all(same_expression(x, y) for x, y in zip(a[1:], b[1:]))


def measurement_assertions(objects, emf, offset):
    """Bind displayed decimals by saved text position, never by predicted value.
    Conservative anchor = saved position + (4,2) in native page pixels. This
    layout is observed in original EMF; other font/layout cases stay uncovered.
    Numeric values stay in the ORIGINAL DISPLAY UNIT, which is preserved verbatim.
    """
    assertions, excluded = [], []
    visible = [o for o in objects if o["constraint"] in MEASURES and o.get("state") == 0]
    if emf is None or offset is None:
        return [], [{"objectIndex": o["objectIndex"], "constraint": o["constraint"],
                     "reason": "measure_no_aligned_original_emf"} for o in visible]
    text = [(i, p) for i, p in enumerate(emf["primitives"])
            if p["kind"] == "text" and p.get("layer") == "gdi" and p.get("text") and p.get("px96")]
    positions = {}
    for o in visible:
        fields = record_fields(o.get("measureRecord", b""), o.get("measureRecordKind"))
        if fields:
            positions[o["objectIndex"]] = [fields["position"][j] - offset[j] for j in (0, 1)]
    for o in visible:
        idx = o["objectIndex"]
        reason = None
        if o["constraint"] == 42:
            reason = "measure_area_superscript_unit_layout_unverified"
        elif idx not in positions:
            reason = "measure_record_layout_unverified"
        else:
            x, y = positions[idx]
            anchor = [(i, p) for i, p in text if abs(p["px96"][0][0] - x - 4) < .25 and abs(p["px96"][0][1] - y - 2) < .25
                      and p.get("color", "").lower() == o.get("color", "").lower()]
            # Restrict a row to the next saved measurement at the same baseline.
            right = min((q[0] + 3.5 for j, q in positions.items() if j != idx and abs(q[1] - y) < 1.25 and q[0] > x + .5), default=math.inf)
            row = sorted([(i, p) for i, p in text if x + 3.5 <= p["px96"][0][0] < right and abs(p["px96"][0][1] - y - 2) < .25], key=lambda v: v[1]["px96"][0][0])
            equals = [j for j, (_, p) in enumerate(row) if p["text"].strip() == "="]
            if len(anchor) != 1 or len(equals) != 1:
                reason = "measure_text_anchor_or_equals_not_unique"
            else:
                tail = row[equals[0] + 1:]
                # Symbol-font minus is often a separate ExtTextOut run.
                normalized = [(i, p["text"].replace("\uf02d", "-").replace("\u2212", "-")) for i, p in tail]
                sign = ""
                if normalized and normalized[0][1] == "-":
                    sign = "-"
                    normalized = normalized[1:]
                if not normalized or not re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", sign + normalized[0][1]):
                    reason = "measure_display_not_plain_decimal"
                else:
                    number = sign + normalized[0][1]
                    value = float(number)
                    digits = len(number.partition(".")[2])
                    numeric_index = normalized[0][0]
                    # Any extra equals/value run is ambiguous; fractions/pi are not decimal assertions.
                    if any(re.search(r"[0-9=]", t) for _, t in normalized[1:]):
                        reason = "measure_display_multirun_or_fraction"
                    else:
                        unit = "".join(t for _, t in normalized[1:]).strip()
                        if unit not in ("", "厘米", "英寸", "像素", "弧度", "°", "\uf0b0", "cm", "in", "px", "rad"):
                            excluded.append({"objectIndex": idx, "constraint": o["constraint"], "reason": "measure_unit_or_neighbor_text_ambiguous"})
                            continue
                        assertions.append({"objectIndex": idx, "constraint": o["constraint"], "kind": "measure", "exists": True,
                            "measurement": {"displayValue": value, "displayNumber": number, "displayUnitText": unit,
                                            "digits": digits, "roundingTolerance": 0.5 * 10 ** -digits + 1e-10},
                            "provenance": {"source": "original_emf_text", "primitiveIndex": numeric_index,
                                           "anchorPrimitiveIndex": anchor[0][0], "layer": "gdi",
                                           "mapping": "unique_saved_measure_position_plus_4_2_and_decimal_after_equals",
                                           "matchingPredictionUsed": False}})
        if reason:
            excluded.append({"objectIndex": idx, "constraint": o["constraint"], "reason": reason})
    # Reject duplicate numeric-run ownership, including overlapping text rows.
    owners = Counter(a["provenance"]["primitiveIndex"] for a in assertions)
    safe = []
    for a in assertions:
        if owners[a["provenance"]["primitiveIndex"]] == 1:
            safe.append(a)
        else:
            excluded.append({"objectIndex": a["objectIndex"], "constraint": a["constraint"], "reason": "measure_text_shared_by_multiple_objects"})
    return safe, excluded
