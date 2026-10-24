#!/usr/bin/env python3
"""Recheck measurement definitions using ONLY existing original-derived assertions.
This research report does not generate oracle values and never launches Sketchpad.
"""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
from emf_match import native_document, distance, predict
from m5_measures import record_fields, expression_tree


def expected_from_parent_geometry(c, ps, angle_mode):
    if c == 36 and len(ps) == 1 and ps[0]["kind"] == "segment":
        g = ps[0]["geometry"]; return distance(g["a"], g["b"])
    if c in (37, 41, 47) and all(p["kind"] == "point" for p in ps):
        pts = [[p["geometry"]["x"], p["geometry"]["y"]] for p in ps]
        if c == 37 and len(pts) == 2:
            return distance(*pts)
        if c == 41 and len(pts) == 3:
            a, b, d = pts; u = [a[j]-b[j] for j in (0,1)]; v = [d[j]-b[j] for j in (0,1)]
            if math.hypot(*u) * math.hypot(*v) < 1e-10: return None
            w = math.atan2(u[1]*v[0]-u[0]*v[1], sum(u[j]*v[j] for j in (0,1)))
            return abs(w) if angle_mode == 1 else w
        if c == 47 and len(pts) == 3:
            a,b,d = pts; ab=distance(a,b); ad=distance(a,d)
            if ab < 1e-10: return None
            # Noncollinear behavior intentionally excluded: not established by this test.
            if abs((b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0])) > 1e-4*max(1,ab*ad): return None
            return math.copysign(ad/ab, sum((b[j]-a[j])*(d[j]-a[j]) for j in (0,1)))
    if c in (40,46) and len(ps)==1 and ps[0]["kind"] in ("circle","disk"):
        return ps[0]["geometry"]["radius"] * (2*math.pi if c==40 else 1)
    if c == 47 and len(ps)==2 and all(p["kind"]=="segment" for p in ps):
        aa,bb=[distance(p["geometry"]["a"],p["geometry"]["b"]) for p in ps]
        return aa/bb if bb>1e-10 else None
    if c in (43,44) and len(ps)==1 and ps[0]["kind"]=="arc":
        g=ps[0]["geometry"]; return abs(g["sweepAngle"])*(g["radius"] if c==44 else 1)
    return None


def run(directory):
    counts=Counter(); definitions={}; mismatches=[]; directed=[]; precision=Counter(); native_angle_sign_checks=[]
    for path in directory.glob("*.json"):
        case=json.loads(path.read_text(encoding="utf8"))
        if "assertions" not in case: continue
        measures=[a for a in case["assertions"] if a["kind"]=="measure"]
        if not measures: continue
        doc=native_document(Path(case["source"]["path"]))
        page=doc["pages"][case["pageIndex"]-1]
        native={o["objectIndex"]:o for o in page["objects"]}
        original_geometry={a["objectIndex"]:a for a in case["assertions"] if a["kind"]!="measure"}
        hints = None
        for a in measures:
            c=a["constraint"];m=a["measurement"];o=native[a["objectIndex"]]
            counts[c]+=1
            fields=record_fields(o["measureRecord"],o["measureRecordKind"])
            precision[(fields["formatWords"][2],m["digits"])]+=1
            if c == 41 and m["displayValue"] < 0 and page.get("preference10042") == 2:
                if hints is None:
                    hints, _ = predict(page["objects"])
                if all(hints.get(i, {}).get("kind") == "point" for i in o["parents"]):
                    pts = [hints[i]["point"] for i in o["parents"]]
                    aa,bb,dd = pts; u=[aa[j]-bb[j] for j in (0,1)]; v=[dd[j]-bb[j] for j in (0,1)]
                    angle=math.degrees(math.atan2(u[1]*v[0]-u[0]*v[1],sum(u[j]*v[j] for j in (0,1))))
                    native_angle_sign_checks.append({"source":case["source"],"objectIndex":o["objectIndex"],"parents":o["parents"],
                        "nativeGraphPoints":pts,"originalDisplayedDegrees":m["displayValue"],"nativeOrderDegrees":angle,
                        "reversedOrderDegrees":-angle,"absoluteErrorDegrees":abs(angle-m["displayValue"]),
                        "passed":abs(angle-m["displayValue"])<=m["roundingTolerance"],
                        "limits":"Parent points reconstructed from saved A-group graph, not independently measured EMF parent dots; expected value is direct original text."})
            if not all(i in original_geometry for i in o["parents"]): continue
            val=expected_from_parent_geometry(c,[original_geometry[i] for i in o["parents"]],page.get("preference10042"))
            if val is None: continue
            u=m["displayUnitText"]
            scale={"":1,"厘米":96/2.54,"英寸":96,"像素":1,"°":math.pi/180,"\uf0b0":math.pi/180,"弧度":1}.get(u)
            if scale is None: continue
            # Parent geometric coordinates are original EMF decimals, tolerance includes their 0.1px quantization.
            tolerance=m["roundingTolerance"]*scale + (0.02 if c in (41,43,47,86) else .21)
            ok=abs(val-m["displayValue"]*scale)<=tolerance
            bucket=definitions.setdefault(str(c),Counter());bucket["checked"]+=1;bucket["passed" if ok else "mismatch"]+=1
            item={"source":case["source"],"pageIndex":case["pageIndex"],"objectIndex":a["objectIndex"],
                  "parents":o["parents"],"originalDisplayed":m,"fromOriginalParentGeometry":val,
                  "scale":scale,"tolerance":tolerance,"absoluteError":abs(val-m["displayValue"]*scale),"passed":ok}
            if not ok:mismatches.append(item)
            if c in (41,86,47) and ok and (val<-.01 or c==47 and abs(val-1)>.1):
                if len(directed)<20: directed.append(item)
    return {"schema":"gsp-m5-original-evidence-v1","measureAssertionsByConstraint":dict(counts),
            "precisionWordVsOriginalDecimalDigits":{str(k):v for k,v in precision.items()},
            "definitionsCheckedAgainstOriginalParentGeometry":definitions,
            "mismatches":mismatches,"asymmetricExamples":directed,"nativeGraphAngleSignChecks":native_angle_sign_checks,
            "limits":"No generated value is an oracle expectation. Hidden/unasserted parents, noncollinear ratios, formatted fractions and area superscripts are unverified."}


if __name__=="__main__":
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument("cases",type=Path);ap.add_argument("--out",type=Path,required=True);args=ap.parse_args()
    report=run(args.cases);args.out.parent.mkdir(parents=True,exist_ok=True);args.out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print(json.dumps({k:v for k,v in report.items() if k not in ("mismatches","asymmetricExamples","nativeGraphAngleSignChecks")},ensure_ascii=False))
