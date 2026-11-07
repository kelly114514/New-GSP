import { describe, expect, it } from 'vitest';
import * as G from '../src/core/geom';
import { Store } from '../src/core/store';
import { createSystem, constructIntersections, constructLines, dilateBy, reflectBy, rotateBy, translateBy } from '../src/core/construct';
import { evaluatePage, pathPointAt, projectToPath, type Shape } from '../src/core/engine';
import { evalExpr, parseExpr, q } from '../src/core/expr';
import { hitAll, hitRect } from '../src/core/hit';
import { labelFor } from '../src/core/store';
import type { Id } from '../src/core/model';

const pointAt = (st: Store, id: Id) => { const s = st.results.get(id)?.shape; if (s?.k !== 'pt') throw new Error(`#${id} 不是点：${JSON.stringify(st.results.get(id))}`); return s.p; };
const free = (st: Store, x: number, y: number) => st.add({ k: 'free', x, y }).id;

describe('几何数学', () => {
  it('退化线段：两端重合时平行线、垂线、角平分线无定义而不是崩溃', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 10, 10), b = free(st, 10, 10), c = free(st, 50, 50);
      const s = st.add({ k: 'seg', a, b }).id;
      st.add({ k: 'parallel', pt: c, line: s }); st.add({ k: 'perp', pt: c, line: s });
      st.add({ k: 'bisect', a: c, v: a, b });
    });
    expect(st.results.get(4)?.status).toBe('ok');            // 重合的两点仍给出（退化的）线段
    expect(st.results.get(5)?.status).toBe('undefined');     // 平行线
    expect(st.results.get(6)?.status).toBe('undefined');     // 垂线
    expect(st.results.get(7)?.status).toBe('undefined');     // 角平分线
  });

  it('平行、重合、相切', () => {
    expect(G.intersectStraights({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, ext: 'line' }, { a: { x: 0, y: 5 }, b: { x: 10, y: 5 }, ext: 'line' })).toBeUndefined();
    expect(G.intersectStraights({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, ext: 'line' }, { a: { x: 3, y: 0 }, b: { x: 20, y: 0 }, ext: 'line' })).toBeUndefined();
    const tangent = G.intersectStraightCircle({ a: { x: -10, y: 5 }, b: { x: 10, y: 5 }, ext: 'line' }, { c: { x: 0, y: 0 }, r: 5 });
    expect(tangent.length).toBe(1);
    expect(G.intersectCircles({ c: { x: 0, y: 0 }, r: 5 }, { c: { x: 10, y: 0 }, r: 5 }).length).toBe(1);   // 外切
    expect(G.intersectCircles({ c: { x: 0, y: 0 }, r: 5 }, { c: { x: 0, y: 0 }, r: 5 }).length).toBe(0);    // 同心重合
  });

  it('线段交点只在线段范围内；射线与直线放宽', () => {
    const seg = (a: [number, number], b: [number, number]) => ({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, ext: 'segment' as const });
    expect(G.intersectStraights(seg([0, 0], [10, 0]), seg([5, -5], [5, 5]))).toEqual({ x: 5, y: 0 });
    expect(G.intersectStraights(seg([0, 0], [10, 0]), seg([15, -5], [15, 5]))).toBeUndefined();
    expect(G.intersectStraights({ ...seg([0, 0], [10, 0]), ext: 'ray' }, seg([15, -5], [15, 5]))).toEqual({ x: 15, y: 0 });
  });

  it('线圆交点分支：沿 a→b 方向 0 号在前；两圆交点 0 号在 c1→c2 方向左侧', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 0, 100), b = free(st, 200, 100), c = free(st, 100, 100), r = free(st, 150, 100);
      const s = st.add({ k: 'seg', a, b }).id, ci = st.add({ k: 'circle', c, p: r }).id;
      st.add({ k: 'inter', a: s, b: ci, branch: 0 }); st.add({ k: 'inter', a: s, b: ci, branch: 1 });
    });
    expect(pointAt(st, 7).x).toBeCloseTo(50); expect(pointAt(st, 8).x).toBeCloseTo(150);
    const p = G.intersectCircles({ c: { x: 100, y: 100 }, r: 60 }, { c: { x: 200, y: 100 }, r: 60 });
    expect(p[0].y).toBeLessThan(p[1].y);     // 水平排列的两圆：0 号在上（屏幕 y 小）
  });

  it('旋转方向：逆时针 90° 把右边的点转到上方；缩放负比例穿过中心', () => {
    const r = G.rotatePt({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0); expect(r.y).toBeCloseTo(-10);
    expect(G.dilatePt({ x: 10, y: 4 }, { x: 0, y: 0 }, -2)).toEqual({ x: -20, y: -8 });
  });

  it('反射把点对称到镜面另一侧', () => {
    const p = G.reflectPt({ x: 3, y: 4 }, { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, ext: 'line' })!;
    expect(p).toEqual({ x: 3, y: -4 });
    expect(G.reflectPt({ x: 1, y: 1 }, { a: { x: 2, y: 2 }, b: { x: 2, y: 2 }, ext: 'line' })).toBeUndefined();
  });

  it('弧边界：圆上弧的起止点；三点弧经过中间点', () => {
    const st = new Store();
    st.run('x', () => {
      const c = free(st, 0, 0), p = free(st, 100, 0), a = free(st, 0, -100), b = free(st, -100, 0), ci = st.add({ k: 'circle', c, p }).id;
      const pa = st.add({ k: 'onpath', path: ci, t: Math.PI / 2 }).id, pb = st.add({ k: 'onpath', path: ci, t: Math.PI }).id;
      st.add({ k: 'arc-circle', circle: ci, a: pa, b: pb }); st.add({ k: 'arc3', a: p, b: a, c: b });
      void a; void b;
    });
    const arc = st.results.get(8)!.shape as Extract<Shape, { k: 'arc' }>;
    expect(arc.sweep).toBeCloseTo(Math.PI / 2);
    const arc3 = st.results.get(9)!.shape as Extract<Shape, { k: 'arc' }>;
    expect(arc3.sweep).toBeCloseTo(Math.PI);
  });

  it('路径点投影：线段端点被夹住，圆取角度', () => {
    const seg: Shape = { k: 'line', s: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, ext: 'segment' } };
    expect(projectToPath(seg, { x: 150, y: 30 })!.t).toBe(1);
    expect(pathPointAt(seg, 0.25)).toEqual({ x: 25, y: 0 });
    const circ: Shape = { k: 'circle', c: { c: { x: 0, y: 0 }, r: 10 } };
    expect(projectToPath(circ, { x: 0, y: -50 })!.p.y).toBeCloseTo(-10);
  });

  it('循环依赖被识别为无定义，不死循环', () => {
    const st = new Store();
    st.run('x', () => { const a = st.add({ k: 'param', name: 'a', value: 1, unit: 'none', showEdit: true }); st.add({ k: 'calc', expr: { t: 'ref', id: 2 }, unit: 'none' }); void a; });
    expect(st.results.get(2)?.status).not.toBe('ok');
  });
});

describe('变换与路径的补充（来自原版课件的写法）', () => {
  const shapeAt = (st: Store, id: Id): Shape => { const s = st.results.get(id)?.shape; if (!s) throw new Error(`#${id} 无结果`); return s; };

  it('平移、旋转、缩放、反射可以直接作用在线段、圆、弧、多边形和圆内部上', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 100, 100), b = free(st, 200, 100), c = free(st, 150, 200), m = free(st, 0, 0);
      const seg = st.add({ k: 'seg', a, b }).id, ci = st.add({ k: 'circle', c, p: b }).id;
      const tri = st.add({ k: 'poly', pts: [a, b, c] }).id, disk = st.add({ k: 'circle-int', circle: ci }).id;
      st.add({ k: 'translate', src: seg, by: { mode: 'rect', dx: 1, dy: 0 } });                           // 9
      st.add({ k: 'rotate', src: seg, center: a, angle: { mode: 'fixed', deg: 90 } });                  // 10
      st.add({ k: 'dilate', src: ci, center: m, ratio: { mode: 'fixed', num: -2, den: 1 } });             // 11
      st.add({ k: 'reflect', src: tri, mirror: seg });                                                    // 12
      st.add({ k: 'dilate', src: disk, center: c, ratio: { mode: 'fixed', num: 1, den: 2 } });             // 13
    });
    const t = shapeAt(st, 9), r = shapeAt(st, 10), d = shapeAt(st, 11), f = shapeAt(st, 12), k = shapeAt(st, 13);
    expect(t.k === 'line' && t.s.a.x).toBeCloseTo(100 + 37.795, 2);          // 1 厘米 ≈ 37.795 像素
    expect(t.k === 'line' && t.s.ext).toBe('segment');
    expect(r.k === 'line' && r.s.b.x).toBeCloseTo(100); expect(r.k === 'line' && r.s.b.y).toBeCloseTo(0);   // 逆时针 90°：右边的点转到上方
    expect(d.k === 'circle' && d.c.r).toBeCloseTo(2 * Math.hypot(50, 100)); expect(d.k === 'circle' && d.c.c.x).toBeCloseTo(-300);
    expect(f.k === 'poly' && f.pts[2].y).toBeCloseTo(0);                                      // 第三个点翻到镜面另一侧
    expect(k.k === 'disk' && k.r).toBeCloseTo(Math.hypot(50, 100) / 2);
  });

  it('射线从圆心出发：1 号分支是朝前的交点；分支号按整条直线计，范围检查在选定之后', () => {
    const st = new Store();
    st.run('x', () => {
      const o = free(st, 100, 100), p = free(st, 150, 100), r = free(st, 130, 100);
      const ray = st.add({ k: 'ray', a: o, b: p }).id, ci = st.add({ k: 'circle', c: o, p: r }).id;
      st.add({ k: 'inter', a: ray, b: ci, branch: 0 }); st.add({ k: 'inter', a: ray, b: ci, branch: 1 });
    });
    expect(st.results.get(6)?.status).toBe('undefined');
    expect(pointAt(st, 7).x).toBeCloseTo(130);
  });

  it('工具中的线圆交点在首选分支离开射线时切换到另一个交点', () => {
    const st = new Store();
    const id = st.run('工具构造', () => {
      const c = free(st, 100, 100), a = free(st, 150, 100), b = free(st, 130, 100);
      const ray = st.add({ k: 'ray', a: c, b: a }).id, circle = st.add({ k: 'circle', c, p: b }).id;
      return st.add({ k: 'inter', a: ray, b: circle, branch: 0, alternate: true }).id;
    });
    expect(pointAt(st, id)).toEqual({ x: 130, y: 100 });
  });

  it('圆与函数图像的两个交点按曲线方向编号，落在采样端点的交点不重复', () => {
    const st = new Store();
    const { first, second, excess } = st.run('曲线截点', () => {
      const sys = createSystem(st, { x: 200, y: 200 }).id;
      const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'num', v: 0 } }).id;
      const curve = st.add({ k: 'plot', func: f, sys, lo: -2, hi: 2, samples: 40 }).id;
      const c = free(st, 200, 200), radius = free(st, 200 + 96 / 2.54, 200);
      const circle = st.add({ k: 'circle', c, p: radius }).id;
      const [first, second, excess] = [0, 1, 2].map(branch => st.add({ k: 'inter', a: circle, b: curve, branch }).id);
      return { first, second, excess };
    });
    expect(pointAt(st, first).x).toBeCloseTo(200 - 96 / 2.54);
    expect(pointAt(st, second).x).toBeCloseTo(200 + 96 / 2.54);
    expect(st.results.get(excess)?.status).toBe('undefined');
  });

  it('独立路径轨迹在当前点无定义时仍采样有定义的区间', () => {
    const st = new Store();
    const { out, trace } = st.run('工具构造', () => {
      const a = free(st, 0, 100), b = free(st, 100, 100), c = free(st, 75, 100), r = free(st, 95, 100), d = free(st, 0, 100);
      const path = st.add({ k: 'seg', a, b }).id, circle = st.add({ k: 'circle', c, p: r }).id;
      const line = st.add({ k: 'perp', pt: d, line: path }).id;
      const out = st.add({ k: 'inter', a: line, b: circle, branch: 0 }).id;
      const trace = st.add({ k: 'locus', driver: d, out, path, samples: 100 }).id;
      return { out, trace };
    });
    expect(st.results.get(out)?.status).toBe('undefined');
    const s = shapeAt(st, trace);
    expect(s.k === 'paths' && s.paths.flat().length).toBeGreaterThan(30);
  });

  it('以圆心和半径绘圆：半径可以是距离度量值', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 0, 0), b = free(st, 0, 0), c = free(st, 300, 300);
      st.add({ k: 'param', name: 't', value: 2, unit: 'distance', showEdit: true });
      void a; void b;
      st.add({ k: 'circle-seg', c, seg: 4 });
    });
    const s = shapeAt(st, 5); expect(s.k === 'circle' && s.c.r).toBeCloseTo(2 * 37.7952755905, 3);
  });

  it('比的度量：三点给出 |AC|/|AB|', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 0, 0), b = free(st, 100, 0), c = free(st, 25, 0);
      st.add({ k: 'measure', m: 'ratio', refs: [a, b, c] });
    });
    const s = shapeAt(st, 4); expect(s.k === 'num' && s.q.v).toBeCloseTo(0.25);
  });
});

describe('度量与单位', () => {
  it('长度以厘米计；角度 0–360；面积平方厘米', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 0, 0), b = free(st, 96 / 2.54 * 3, 0), c = free(st, 0, 96 / 2.54 * 4);
      const s = st.add({ k: 'seg', a, b }).id;
      st.add({ k: 'measure', m: 'length', refs: [s] }); st.add({ k: 'measure', m: 'angle', refs: [b, a, c] }); const poly = st.add({ k: 'poly', pts: [a, b, c] }).id;
      st.add({ k: 'measure', m: 'area', refs: [poly] }); st.add({ k: 'measure', m: 'perimeter', refs: [poly] });
    });
    const v = (id: Id) => (st.results.get(id)!.shape as { q: { v: number } }).q.v;
    expect(v(5)).toBeCloseTo(3, 6);
    expect(v(6)).toBeCloseTo(270, 6);            // 从 ab 到 ac 逆时针（屏幕向上为正）
    expect(v(8)).toBeCloseTo(6, 6);
    expect(v(9)).toBeCloseTo(12, 6);
  });

  it('坐标系：横纵坐标、斜率、坐标距离', () => {
    const st = new Store();
    st.run('x', () => {
      const sys = createSystem(st, { x: 100, y: 200 });
      const p = free(st, 100 + 96 / 2.54 * 2, 200 - 96 / 2.54 * 3);
      st.add({ k: 'measure', m: 'abscissa', refs: [p, sys.id] }); st.add({ k: 'measure', m: 'ordinate', refs: [p, sys.id] });
    });
    const v = (id: Id) => (st.results.get(id)!.shape as { q: { v: number } }).q.v;
    expect(v(8)).toBeCloseTo(2); expect(v(9)).toBeCloseTo(3);
  });
});

describe('表达式与单位', () => {
  const parse = (t: string) => parseExpr(t, { resolve: () => undefined });
  const ev = (t: string) => evalExpr(parse(t), { ref: () => undefined });
  it('四则、幂、括号、常量', () => {
    expect(ev('1+2*3')?.v).toBe(7); expect(ev('(1+2)*3')?.v).toBe(9); expect(ev('2^3^2')?.v).toBe(512); expect(ev('-2^2')?.v).toBe(-4);
    expect(ev('pi')?.v).toBeCloseTo(Math.PI); expect(ev('2e')?.v).toBeCloseTo(2 * Math.E);
  });
  it('三角函数按“度”计算（原版默认单位）：sin(30)=sin(30°)=0.5，sin(0.5)=0.0087；反三角返回度', () => {
    expect(ev('sin(30°)')?.v).toBeCloseTo(0.5);
    expect(ev('sin(30)')?.v).toBeCloseTo(0.5);
    expect(ev('sin(0.5)')?.v).toBeCloseTo(Math.sin((0.5 * Math.PI) / 180));
    expect(ev('arcsin(0.5)')).toEqual({ v: expect.closeTo(30, 6), u: 'angle' });
  });
  it('计算错误：除零、负数开方、对数定义域、arcsin 超界', () => {
    for (const t of ['1/0', 'sqrt(-1)', 'ln(0)', 'log(-2)', 'arcsin(2)', 'tan(90°)']) expect(ev(t)).toBeUndefined();
  });
  it('语法错误给出可读的信息', () => {
    for (const t of ['1+', '(1+2', '*3', 'foo(2)']) expect(() => parse(t)).toThrow();
  });
  it('单位参与运算', () => {
    expect(evalExpr({ t: 'bin', op: '+', a: { t: 'num', v: 1, u: 'distance' }, b: { t: 'num', v: 2 } }, { ref: () => undefined })).toEqual(q(3, 'distance'));
  });
});

describe('函数图像', () => {
  it('1/x 在 0 处断开，不画出错误连线；大范围采样随视图更新', () => {
    const st = new Store();
    st.ctx = { view: { x0: 0, y0: 0, x1: 800, y1: 600 } };
    st.run('x', () => {
      const sys = createSystem(st, { x: 400, y: 300 });
      const f = st.add({ k: 'func', name: 'f', param: 'x', expr: { t: 'bin', op: '/', a: { t: 'num', v: 1 }, b: { t: 'x' } } });
      st.add({ k: 'plot', func: f.id, sys: sys.id, samples: 400 });
    });
    const plot = st.results.get(st.page.objects.find(o => o.def.k === 'plot')!.id)!.shape as Extract<Shape, { k: 'paths' }>;
    expect(plot.paths.length).toBeGreaterThanOrEqual(2);
    // 渐近线两侧的分支不能连在一起：每条路径要么全在横轴上方，要么全在下方
    for (const path of plot.paths) expect(new Set(path.map(pt => Math.sign(pt.y - 300))).size).toBe(1);
  });
});

describe('作图与变换命令', () => {
  it('三点连线首尾相接；复用已有线段', () => {
    const st = new Store();
    st.run('x', () => { const a = free(st, 0, 0), b = free(st, 50, 0), c = free(st, 0, 50); st.add({ k: 'seg', a, b }); constructLines(st, 'seg', [a, b, c]); });
    expect(st.page.objects.filter(o => o.def.k === 'seg').length).toBe(3);
  });
  it('两圆相交一次建出两个交点；线段不相交时不建', () => {
    const st = new Store();
    st.run('x', () => {
      const a = free(st, 0, 0), b = free(st, 100, 0), c = free(st, 100, 0), d = free(st, 200, 0);
      const c1 = st.add({ k: 'circle', c: a, p: b }).id, c2 = st.add({ k: 'circle', c, p: d }).id;
      expect(constructIntersections(st, c1, c2).length).toBe(2);
    });
  });
  it('变换整个线段：生成像点和像线段，并随原图联动', () => {
    const st = new Store();
    let ids: Id[] = [];
    st.run('x', () => {
      const a = free(st, 0, 0), b = free(st, 100, 0), c = free(st, 0, 100), s = st.add({ k: 'seg', a, b }).id;
      ids = [a, b, c, s];
      const t = translateBy(st, [s], { mode: 'rect', dx: 0, dy: 1 }); expect(t.map(o => o.def.k)).toEqual(['translate', 'translate', 'seg']);
      rotateBy(st, [s], c, { mode: 'fixed', deg: 90 }); dilateBy(st, [s], c, { mode: 'fixed', num: 1, den: 2 }); reflectBy(st, [s], s);
    });
    st.run('move', () => st.moveFree(ids[0], 10, 0));
    const seg = st.page.objects.filter(o => o.def.k === 'seg')[1];
    const sh = st.results.get(seg.id)!.shape as Extract<Shape, { k: 'line' }>;
    expect(sh.s.a.x).toBeCloseTo(10); expect(sh.s.a.y).toBeCloseTo(-96 / 2.54);
  });
});

describe('撤消与事务', () => {
  it('拖动期间连续更新，一次撤消恢复整个动作；取消不留痕迹', () => {
    const st = new Store();
    st.run('a', () => { free(st, 0, 0); });
    st.begin('拖动'); for (let i = 1; i <= 30; i++) st.moveFree(1, i, i); st.commit();
    expect(st.undoName).toBe('拖动'); expect(pointAt(st, 1)).toEqual({ x: 30, y: 30 });
    st.doUndo(); expect(pointAt(st, 1)).toEqual({ x: 0, y: 0 });
    st.doRedo(); expect(pointAt(st, 1)).toEqual({ x: 30, y: 30 });
    st.begin('作图'); st.add({ k: 'free', x: 5, y: 5 }); st.cancel();
    expect(st.page.objects.length).toBe(1);
  });
  it('只读保护：含未知对象的文件拒绝编辑', () => {
    const st = new Store();
    st.protectedReason = '含有新版暂不支持的对象';
    expect(() => st.run('x', () => st.add({ k: 'free', x: 1, y: 1 }))).toThrow(/只读/);
  });
});

describe('标签', () => {
  it('字母用完 Z 后接下标；删除后不回收', () => {
    expect(labelFor(0)).toBe('A'); expect(labelFor(25)).toBe('Z'); expect(labelFor(26)).toBe('A₁'); expect(labelFor(27)).toBe('B₁');
    const st = new Store();
    st.run('x', () => { const a = st.add({ k: 'free', x: 0, y: 0 }); st.showLabel(a.id, true); st.remove([a.id]); const b = st.add({ k: 'free', x: 0, y: 0 }); st.showLabel(b.id, true); expect(b.label).toBe('B'); });
  });
});

describe('命中与框选', () => {
  it('三档命中半径；点优先于线', () => {
    const st = new Store();
    st.run('x', () => { const a = free(st, 100, 100), b = free(st, 300, 100); st.add({ k: 'seg', a, b }); });
    const hit = (x: number, y: number, p: 'low' | 'mid' | 'high') => hitAll(st.page, st.results, { x, y }, p);
    expect(hit(100, 103, 'low')).toEqual([1, 3]);          // 点压着线：点排在前面
    expect(hit(100, 108, 'low')).toEqual([1]);             // 点 8 px 内命中，线 8 px 外不中
    expect(hit(100, 111, 'low')).toEqual([]);              // 11 px 外都不中
    expect(hit(200, 105, 'low')).toEqual([3]); expect(hit(200, 106, 'low')).toEqual([]);
    expect(hit(200, 108, 'mid')).toEqual([3]); expect(hit(200, 114, 'high')).toEqual([3]);
  });
  it('框选相交即选中', () => {
    const st = new Store();
    st.run('x', () => { const a = free(st, 100, 100), b = free(st, 300, 100); st.add({ k: 'seg', a, b }); });
    expect(hitRect(st.page, st.results, { x0: 190, y0: 90, x1: 210, y1: 110 })).toEqual([3]);
    expect(hitRect(st.page, st.results, { x0: 190, y0: 120, x1: 210, y1: 140 })).toEqual([]);
  });
});

describe('性能', () => {
  it('1000 个普通几何对象：拖动一个自由点的重算耗时 P95 ≤ 33ms', () => {
    const st = new Store();
    st.run('x', () => {
      const pts: Id[] = [];
      for (let i = 0; i < 250; i++) pts.push(free(st, (i % 25) * 30, Math.floor(i / 25) * 30));
      for (let i = 0; i + 1 < 250; i++) st.add({ k: 'seg', a: pts[i], b: pts[i + 1] });
      for (let i = 0; i < 249; i++) st.add({ k: 'mid', seg: 251 + i });
      for (let i = 0; i < 250; i++) st.add({ k: 'circle', c: pts[i], p: pts[(i + 3) % 250] });
      void evaluatePage;
    });
    expect(st.page.objects.length).toBeGreaterThanOrEqual(990);
    const times: number[] = [];
    st.begin('drag');
    for (let i = 0; i < 200; i++) { const t0 = performance.now(); st.moveFree(1, i, i); st.recompute([1]); times.push(performance.now() - t0); }
    st.commit();
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.log(`重算 P95 = ${p95.toFixed(2)} ms（${st.page.objects.length} 个对象）`);
    expect(p95).toBeLessThanOrEqual(33);
  });
});
