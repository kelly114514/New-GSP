"""Independent coordinate search hints. No impl imports; expectations come from EMF only.

Page coordinates have y down. Unknown layouts and unverified branches return None.
"""
import math
import struct

GEOMETRIC = {52, 54, 58, 59, 60, 61, 69}
NUMERIC = {65, 66, 86, 94}
HTML = {"UnitPoint": (1, {52}), "SquareUnitPoint": (1, {54}),
        "HorizontalAxis": (2, {58}), "VerticalAxis": (2, {58}),
        "CoordSysByAxes": (2, {61}), "PlotXY": (3, {69}), "PointValue": (2, {94})}


def axis_direction(obj):
    raw = obj.get("coordRecord", b"")
    if len(raw) not in (2, 4):
        return None
    n = struct.unpack_from("<H", raw)[0]
    return n if n in (0, 1) else None


def unit_length(obj):
    raw = obj.get("constraintExtra", b"")
    if len(raw) != 12 or struct.unpack_from("<2H", raw) != (obj["constraint"], 0):
        return None
    n = struct.unpack_from("<d", raw, 4)[0]
    return n if math.isfinite(n) and n > 0 else None


def coordinates(point, system):
    if not system or system["kind"] != "coordinate-system":
        return None
    o, u, v = system["origin"], system["u"], system["v"]
    d = u[0]*v[1]-u[1]*v[0]
    if abs(d) < 1e-12:
        return None
    x,y = point[0]-o[0], point[1]-o[1]
    return [(x*v[1]-y*v[0])/d, (u[0]*y-u[1]*x)/d]


def path_value(point, path):
    if 'axisDirection' in path:return None  # Native 15's axis storage basis does not establish logical 94.
    kind = path["kind"]
    if kind in ("segment", "line", "ray"):
        a,b=path["a"],path["b"]
        dx,dy=b[0]-a[0],b[1]-a[1]; den=dx*dx+dy*dy
        if den <= 1e-20:return None
        t=((point[0]-a[0])*dx+(point[1]-a[1])*dy)/den
        return min(1,max(0,t)) if kind=="segment" else max(0,t) if kind=="ray" else t
    if kind=="circle":
        dx,dy=point[0]-path["center"][0],point[1]-path["center"][1]
        if math.hypot(dx,dy)<1e-10:return None
        return (math.atan2(-dy,dx)/(2*math.pi))%1
    return None


def hint(obj, ps, objects):
    c=obj["constraint"]
    if any(p is None for p in ps):return None
    points=[p["point"] for p in ps if p["kind"]=="point"]
    if c==52 and len(ps)==1 and len(points)==1:
        n=unit_length(obj)
        if n is not None:return {"kind":"point","point":[points[0][0]+n,points[0][1]]}
    if c==54 and len(ps)==1 and len(points)==1:
        if unit_length(obj) is None:return None
        parent=objects[obj["parents"][0]-1]
        n=unit_length(parent) if parent["constraint"]==52 else None
        if n is not None:return {"kind":"point","point":[points[0][0]-n,points[0][1]-n]}
    if c in (58,59,60):
        direction=axis_direction(obj)
        if direction is None:return None
        if c==58 and len(ps)==2 and len(points)==2:
            o,u=points
            dx,dy=u[0]-o[0],u[1]-o[1]
            if abs(dy if direction else dx)>1e-7:return None
            n=dx if direction else -dy
        elif c==59 and len(ps)==2 and ps[0]["kind"]=="point":
            o=ps[0]["point"];q=ps[1]
            if q["kind"]=="segment":n=math.dist(q["a"],q["b"])
            elif q["kind"]=="number" and q["dimension"]=="length":n=q["value"]
            else:return None
        elif c==60 and len(ps)==1 and ps[0]["kind"]=="circle":
            o=ps[0]["center"];n=ps[0]["radius"]
        else:return None
        if n<=1e-10:return None
        v=[n,0] if direction else [0,-n]
        return {"kind":"line","a":o,"b":[o[0]+v[0],o[1]+v[1]],"axisDirection":direction}
    if c==61 and len(ps)==2 and all(p["kind"]=="line" for p in ps):
        raw=obj.get("coordRecord",b"")
        if len(raw) not in (2,8) or struct.unpack_from('<H',raw)[0] not in (1,2):return None
        x,y=ps
        if x.get("axisDirection")!=1 or y.get("axisDirection")!=0 or math.dist(x["a"],y["a"])>1e-7:return None
        return {"kind":"coordinate-system","origin":x["a"],"u":[x["b"][j]-x["a"][j] for j in (0,1)],
                "v":[y["b"][j]-y["a"][j] for j in (0,1)]}
    if c==69 and len(ps)==3 and all(p["kind"]=="number" and p["dimension"]=="number" for p in ps[:2]) and ps[2]["kind"]=="coordinate-system":
        x,y=ps[0]["value"],ps[1]["value"];k=ps[2]
        return {"kind":"point","point":[k["origin"][j]+x*k["u"][j]+y*k["v"][j] for j in (0,1)]}
    result=None
    if c in (65,66) and len(ps)==2 and len(points)==1:
        xy=coordinates(points[0],ps[1]);result=xy[c-65] if xy else None
    if c==86 and len(ps)==3 and len(points)==2:
        a,b=coordinates(points[0],ps[2]),coordinates(points[1],ps[2])
        if a and b:result=math.dist(a,b)
    if c==94 and len(ps)==2 and ps[0]["kind"]=="point":result=path_value(ps[0]["point"],ps[1])
    return {"kind":"number","value":result,"dimension":"number"} if result is not None and math.isfinite(result) else None
