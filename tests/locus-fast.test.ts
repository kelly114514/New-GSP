import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';

describe('轨迹线段中点链', () => {
  it('快速路径与通用路径的采样逐点一致，并在拖动后重新计算', () => {
    const st = new Store(); let a = 0, seg = 0, locus = 0;
    st.run('构造', () => {
      a = st.add({ k: 'free', x: 20, y: 60 }).id;
      const b = st.add({ k: 'free', x: 350, y: 200 }).id;
      const path = st.add({ k: 'seg', a, b }).id;
      let p = st.add({ k: 'onpath', path, t: .5 }).id;
      for (let i = 0; i < 6; i++) { seg = st.add({ k: 'seg', a: p, b }).id; p = st.add({ k: 'mid', seg }).id; }
      locus = st.add({ k: 'locus', driver: path + 1, out: p, samples: 200 }).id;
    });
    const compare = () => {
      st.recompute(); const fast = structuredClone(st.results.get(locus));
      const object = st.get(seg)!; const original = object.def;
      if (original.k !== 'seg') throw Error('预期线段');
      object.def = { ...original, k: 'line' }; st.recompute();
      expect(st.results.get(locus)).toEqual(fast);
      object.def = original;
    };
    compare(); st.run('移动', () => st.moveFree(a, 120, 35)); compare();
  });
});
