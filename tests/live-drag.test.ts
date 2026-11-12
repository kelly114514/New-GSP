import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { evaluatePage, type Shape } from '../src/core/engine';
import { byId, type Id } from '../src/core/model';
import { hitAll } from '../src/core/hit';

/** 一组共用驱动点的轨迹：驱动点在线段上，经中垂线类依赖得到两个输出点。 */
function twoLoci() {
  const st = new Store(); let a = 0, l1 = 0, l2 = 0;
  st.run('构造', () => {
    a = st.add({ k: 'free', x: 20, y: 60 }).id;
    const b = st.add({ k: 'free', x: 350, y: 200 }).id, c = st.add({ k: 'free', x: 200, y: 20 }).id;
    const path = st.add({ k: 'seg', a, b }).id, drv = st.add({ k: 'onpath', path, t: .5 }).id;
    const line = st.add({ k: 'line', a: c, b: drv }).id;
    const circ = st.add({ k: 'circle', c, p: a }).id;
    const hit = st.add({ k: 'inter', a: line, b: circ, branch: 0 }).id;
    const r1 = st.add({ k: 'dilate', src: hit, center: b, ratio: { mode: 'fixed', num: 1, den: 2 } }).id;
    const r2 = st.add({ k: 'dilate', src: hit, center: c, ratio: { mode: 'fixed', num: 1, den: 4 } }).id;
    l1 = st.add({ k: 'locus', driver: drv, out: r1, samples: 300 }).id;
    l2 = st.add({ k: 'locus', driver: drv, out: r2, samples: 300 }).id;
  });
  return { st, a, l1, l2 };
}
const count = (st: Store, id: Id) => { const s = st.results.get(id)?.shape; return s?.k === 'paths' ? s.paths.reduce((n, p) => n + p.length, 0) : 0; };

describe('拖动性能相关的求值', () => {
  it('byId 在对象数组就地变化后仍与线性查找一致', () => {
    const st = new Store();
    const ids = st.run('构造', () => [1, 2, 3].map(x => st.add({ k: 'free', x, y: 0 }).id));
    const p = st.page;
    expect(byId(p, ids[1])?.id).toBe(ids[1]);
    const removed = p.objects.pop()!;
    expect(byId(p, removed.id)).toBeUndefined();
    p.objects.push(removed);
    expect(byId(p, removed.id)).toBe(removed);
    // 同长度替换：索引过期也要找得到
    const other = { ...removed, id: 99 }; p.objects[2] = other;
    expect(byId(p, 99)).toBe(other);
    expect(byId(p, removed.id)).toBeUndefined();
    // 新数组
    p.objects = p.objects.slice(0, 1);
    expect(byId(p, ids[1])).toBeUndefined();
  });

  it('changed 传一次性迭代器时后代也会重算', () => {
    const { st, a } = twoLoci();
    const hit = st.page.objects.find(o => o.def.k === 'seg')!.id;
    const before = JSON.stringify(st.results.get(hit));
    st.moveFree(a, 90, 90, false);
    st.recompute(new Map([[a, 1]]).keys());
    expect(JSON.stringify(st.results.get(hit))).not.toBe(before);
  });

  it('共用驱动点的轨迹与单独求值逐点一致', () => {
    const { st, a, l1, l2 } = twoLoci();
    const check = () => {
      const page = st.page;
      const alone = (id: Id) => { const without = { ...page, objects: page.objects.filter(o => o.id === id || o.def.k !== 'locus') }; return evaluatePage(without, undefined, undefined, st.ctx).get(id); };
      const all = evaluatePage(page, undefined, undefined, st.ctx);
      expect(count(st, l1)).toBeGreaterThan(10);
      expect(all.get(l1)).toEqual(alone(l1));
      expect(all.get(l2)).toEqual(alone(l2));
    };
    check(); st.run('移动', () => st.moveFree(a, 60, 120)); check();
  });

  it('多图形对象只命中一次，并按最近图形排序', () => {
    const st = new Store();
    const a = st.add({ k: 'free', x: 2, y: 0 }).id;
    const b = st.add({ k: 'free', x: 5, y: 0 }).id;
    const parts: Shape[] = Array.from({ length: 150 }, () => ({ k: 'pt', p: { x: 5, y: 0 } }));
    parts.push({ k: 'pt', p: { x: 1, y: 0 } });
    st.results.set(b, { status: 'ok', shape: { k: 'multi', items: parts } });
    expect(hitAll(st.page, st.results, { x: 0, y: 0 }, 'low')).toEqual([b, a]);
  });

  it('嵌套轨迹及路径点在每次拖动重算中与完整求值一致', () => {
    const { st, a, l1 } = twoLoci();
    const { outer, inner } = st.run('构造嵌套轨迹', () => {
      const axis = st.add({ k: 'seg', a, b: st.page.objects[1].id }).id;
      const driver = st.add({ k: 'onpath', path: axis, t: .4 }).id;
      const circle = st.add({ k: 'circle', c: driver, p: a }).id;
      const t = st.add({ k: 'onpath', path: circle, t: 0 }).id;
      const inner = st.add({ k: 'locus', driver: t, out: t, samples: 173 }).id;
      const out = st.add({ k: 'onpath', path: inner, t: .31 }).id;
      const outer = st.add({ k: 'locus', driver, out, samples: 103 }).id;
      st.add({ k: 'onpath', path: l1, t: .41 });
      return { outer, inner };
    });

    st.begin('拖动');
    for (const [x, y] of [[30, 80], [41, 91], [55, 88]]) {
      st.moveFree(a, x, y, false);
      st.recompute([a]);
      expect(count(st, outer)).toBeGreaterThan(64);
      expect(count(st, inner)).toBe(174);
      expect(st.results).toEqual(evaluatePage(st.page));
    }
    const during = st.results;
    st.commit();
    expect(st.results).toBe(during);
    st.doUndo();
    expect(st.results).toEqual(evaluatePage(st.page));
  });
});
