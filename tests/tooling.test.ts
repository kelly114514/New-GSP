import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { newDoc, parentsOf } from '../src/core/model';
import { acceptsInput, applyTool, buildTool, createToolObjects, initialToolPathParameter } from '../src/core/tooling';
import { decodeFile, decodeToolBody, encodeFile, encodeNgsp, encodeToolBody } from '../src/gsp/codec';
import { groupName, loadToolFile, resolveTool } from '../src/toolkit';
import { toolInputFixture as feed } from '../tools/tool-input-fixture';

// 原版的工具文件夹只在开发机上有（不进仓库、不随软件发布）；没有就跳过。
const TOOLS = join(__dirname, '../../sketchpad5/Tool Folder');
const have = existsSync(TOOLS);
const allGroups = () => readdirSync(TOOLS).filter(x => /\.gsp$/i.test(x)).sort().flatMap(f => { const g = loadToolFile(f, new Uint8Array(readFileSync(join(TOOLS, f)))); return g ? [g] : []; });


describe('groupName', () => {
  it('去掉序号和扩展名', () => {
    expect(groupName('01 线工具.gsp')).toBe('线工具');
    expect(groupName('40 [3d]基本工具.gsp')).toBe('[3d]基本工具');
  });
});

describe.skipIf(!have)('载入 44 个工具文件', () => {
  const groups = allGroups();
  it('807 个工具全部能解析，名称都不空', () => {
    expect(groups).toHaveLength(44);
    const tools = groups.flatMap(g => g.tools);
    expect(tools).toHaveLength(807);
    expect(tools.every(t => t.name.length > 0 && !t.name.includes('\ufffd'))).toBe(true);
    let usable = 0;
    for (const g of groups) for (const r of g.tools) if (!resolveTool(r).blocked) usable++;
    console.log(`可用工具 ${usable} / 807`);
    expect(usable).toBe(807);
  });
  it('807 个工具：合成输入重放不抛错，整批对象引用完整；统计实际求值状态', () => {
    let applied = 0, evaluated = 0, total = 0;
    const bad: string[] = [];
    for (const g of groups) for (const r of g.tools) {
      const tool = resolveTool(r);
      if (tool.blocked) continue;
      const { st, picks } = feed(tool);
      let made: ReturnType<typeof applyTool> = [];
      let seed = 123456789;
      const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      try { st.run(tool.name, () => { made = applyTool(st, tool, picks, () => ({ x: 20, y: 200 }), { random }); }); applied++; }
      catch (e) { bad.push(`${g.name}/${tool.name}: ${(e as Error).message}`); continue; }
      for (const o of st.page.objects) for (const p of parentsOf(o.def)) {
        if (!st.get(p)) bad.push(`${g.name}/${tool.name}: #${o.id} 引用不存在的 #${p}`);
      }
      for (const o of st.page.objects) {
        const status = st.results.get(o.id)?.status;
        if (!status || status === 'missing' || status === 'unsupported') bad.push(`${g.name}/${tool.name}: #${o.id} ${o.def.k} ${status}`);
      }
      for (const o of made) { total++; if (st.results.get(o.id)?.status === 'ok') evaluated++; }
      expect(st.page.objects.some(o => o.def.k === 'unknown'), tool.name).toBe(false);
      const restored = new Store(decodeFile(encodeNgsp(st.doc), '工具回放.ngsp').doc);
      expect(restored.page.objects.map(o => o.def), tool.name).toEqual(st.page.objects.map(o => o.def));
      expect(restored.results, tool.name).toEqual(st.results);
    }
    console.log(`应用成功 ${applied}；可见新对象 ${total}，其中有求值结果 ${evaluated}`);
    expect(bad).toEqual([]);
  }, 30000);
  it('一次应用是一步撤销', () => {
    const tool = groups.flatMap(g => g.tools).map(resolveTool).find(t => !t.blocked && t.inputs.length === 2 && t.inputs.every(i => i.kind === 'point'))!;
    const { st, picks } = feed(tool);
    const before = st.page.objects.length;
    st.run(tool.name, () => { applyTool(st, tool, picks, () => ({ x: 0, y: 0 })); });
    expect(st.page.objects.length).toBeGreaterThan(before);
    st.doUndo();
    expect(st.page.objects.length).toBe(before);
  });
  it('区间阴影在两个输入点之间绘制一组线段，移动后跟随区间', () => {
    const ref = groups.flatMap(g => g.tools).find(t => t.name === '石岩|区间阴影')!;
    const tool = resolveTool(ref), st = new Store();
    const picks = st.run('输入', () => [st.add({ k: 'free', x: 100, y: 120 }).id, st.add({ k: 'free', x: 300, y: 250 }).id]);
    const output = st.run('工具', () => applyTool(st, tool, picks, () => ({ x: 20, y: 20 }), { random: () => 0.2 }));
    const locus = output.find(o => o.def.k === 'locus')!;
    expect(locus.def).toMatchObject({ samples: 250 });
    const span = () => {
      const s = st.results.get(locus.id)?.shape;
      if (s?.k !== 'multi' || !s.items.every(it => it.k === 'line')) throw new Error('阴影轨迹没有线段');
      const xs = s.items.map(it => it.k === 'line' ? it.s.a.x : NaN);
      expect(xs.length).toBeGreaterThan(20);
      return Math.max(...xs) - Math.min(...xs);
    };
    const before = span();
    expect(before).toBeGreaterThan(150);
    st.run('移动', () => st.moveFree(picks[1], 400, 250));
    expect(span()).toBeGreaterThan(before + 60);
  });
  it('原版点轨迹、圆内部与着色多边形工具采用不同的采样数', () => {
    const cases = [
      ['实体工具', '平截头体', [500, 500, 500, 500, 500, 500]],
      ['经典坐标系', '数列图象生成工具', [62, 500]],
      ['[3d]着色工具', '【函数】函数发生器3', [125]],
    ] as const;
    const tools = groups.flatMap(g => g.tools.map(resolveTool));
    for (const [group, name, samples] of cases) {
      const tool = tools.find(t => t.group === group && t.name === name);
      if (!tool) throw new Error(`找不到工具 ${name}`);
      const { st, picks } = feed(tool);
      st.run('重放轨迹工具', () => applyTool(st, tool, picks, () => ({ x: 20, y: 20 }), { random: () => 0.37 }));
      const loci = st.page.objects.flatMap(o => o.def.k === 'locus' ? [o.def.samples] : []);
      expect(loci, name).toEqual(samples);
    }
  });
  it('有界滑块换了视口也能拖到原版的第十个单位', () => {
    const tools = groups.flatMap(g => g.tools.map(resolveTool)).filter(t => t.group === '滑块工具' && /^有界的[水平垂直]{2}滑块$/.test(t.name));
    expect(tools).toHaveLength(2);
    for (const tool of tools) {
      const { st, picks } = feed(tool);
      st.setView({ x0: 0, y0: 0, x1: 500, y1: 450 });
      st.run('重放滑块工具', () => applyTool(st, tool, picks, () => ({ x: 20, y: 20 }), { random: () => 0.5 }));
      const graph = st.page.objects.find(o => o.def.k === 'plot')!;
      expect(graph.def).toMatchObject({ lo: -10, hi: 10, samples: 750 });
      const point = st.page.objects.find(o => o.def.k === 'onpath' && o.def.path === graph.id)!;
      if (point.def.k !== 'onpath') throw new Error('滑块没有附着点');
      const d = point.def;
      st.setView({ x0: 300, y0: 200, x1: 900, y1: 600 });
      st.run('拖到端点', () => st.update(point.id, { ...d, t: 1 }));
      const ratio = st.page.objects.find(o => o.def.k === 'measure' && o.def.m === 'ratio')!;
      const q = st.results.get(ratio.id)?.shape;
      expect(q?.k === 'num' && q.q.v).toBeCloseTo(10);
    }
  });
  it.each([['过三点的抛物线(2)', 1], ['01 立体几何平台', 3]] as const)(
    '%s 在不同视口中保留原版的固定图像范围', (name, count) => {
      const ref = groups.flatMap(g => g.tools).find(t => t.name === name)!;
      const tool = resolveTool(ref);
      for (const x0 of [0, 180]) {
        const { st, picks } = feed(tool);
        st.setView({ x0, y0: 0, x1: x0 + 500, y1: 450 });
        st.run('应用工具', () => applyTool(st, tool, picks, () => ({ x: 20, y: 20 }), { random: () => 0.37 }));
        const plots = st.page.objects.filter(o => o.def.k === 'plot');
        expect(plots).toHaveLength(count);
        for (const plot of plots) expect(plot.def).toMatchObject({ lo: -10, hi: 10, samples: 750 });
      }
    },
  );
});

it('路径点优先在可见部分初始化，视口以页面坐标计', () => {
  const values = [0, 1];
  const view = { x0: 75, y0: -10, x1: 100, y1: 10 };
  const s = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, ext: 'segment' as const };
  expect(initialToolPathParameter({ k: 'line', s }, () => values.shift()!, view)).toBeCloseTo(0.9);
  expect(initialToolPathParameter({ k: 'line', s: { ...s, ext: 'line' } }, () => 0.5,
    { ...view, x0: 500, x1: 700 })).toBeCloseTo(6);
});

describe('创建工具 → 编码 → 解析 → 应用', () => {
  it('三点作三角形加边长：往返后结构一致，应用到新点得到同样的构造', () => {
    const st = new Store(newDoc('t'));
    let sel: number[] = [];
    st.run('作图', () => {
      const a = st.add({ k: 'free', x: 100, y: 100 }), b = st.add({ k: 'free', x: 300, y: 120 }), c = st.add({ k: 'free', x: 180, y: 300 });
      const ab = st.add({ k: 'seg', a: a.id, b: b.id }), bc = st.add({ k: 'seg', a: b.id, b: c.id }), ca = st.add({ k: 'seg', a: c.id, b: a.id });
      const len = st.add({ k: 'measure', m: 'length', refs: [ab.id] }, { at: { x: 20, y: 20 } });
      sel = [ab.id, bc.id, ca.id, len.id];
    });
    const made = createToolObjects(st.page, sel);
    if ('error' in made) throw new Error(made.error);
    expect(made.prereq).toHaveLength(3);
    const emb = encodeToolBody(made.objects, '三角形', made.prereq, '测试');
    expect(emb.name).toBe('三角形'); expect(emb.prereq).toEqual(made.prereq); expect(emb.comment).toBe('测试');
    const { page } = decodeToolBody(emb);
    const tool = buildTool(emb, page);
    expect(tool.blocked).toBeUndefined();
    expect(tool.objects.map(o => o.def.k)).toEqual(made.objects.map(o => o.def.k));
    expect(tool.objects.filter(o => !o.hidden).map(o => o.def.k)).toEqual(['seg', 'seg', 'seg', 'measure']);
    const st2 = new Store(newDoc('u'));
    let picks: number[] = [], out: ReturnType<typeof applyTool> = [];
    st2.run('点', () => { picks = [[50, 60], [250, 80], [120, 260]].map(([x, y]) => st2.add({ k: 'free', x, y }).id); });
    st2.run('工具', () => { out = applyTool(st2, tool, picks, () => ({ x: 20, y: 20 })); });
    expect(out.map(o => o.def.k)).toEqual(['seg', 'seg', 'seg', 'measure']);
    expect(out[3]!.def).toMatchObject({ k: 'measure', m: 'length', refs: [out[0]!.id] });
    expect(st2.results.get(out[3]!.id)?.shape?.k).toBe('num');
  });
  it('参数前提创建、保存后重放，并随输入参数变化', () => {
    const st = new Store(newDoc('t'));
    let result = 0;
    st.run('x', () => {
      const p = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }, { at: { x: 1, y: 1 } });
      result = st.add({ k: 'calc', expr: { t: 'bin', op: '+', a: { t: 'ref', id: p.id }, b: { t: 'num', v: 1 } }, unit: 'none' }, { at: { x: 20, y: 20 } }).id;
    });
    const r = createToolObjects(st.page, [result]);
    if ('error' in r) throw new Error(r.error);
    const emb = encodeToolBody(r.objects, '加一', r.prereq);
    const tool = buildTool(emb, decodeToolBody(emb).page);
    expect(tool.blocked).toBeUndefined();
    expect(tool.inputs.map(i => i.kind)).toEqual(['number']);
    const target = new Store(newDoc('target'));
    let input = 0, output = 0;
    target.run('输入', () => { input = target.add({ k: 'param', name: 'n', value: 3, unit: 'none', showEdit: true }).id; });
    target.run('工具', () => { output = applyTool(target, tool, [input], () => ({ x: 20, y: 20 }))[0]!.id; });
    expect(target.results.get(output)?.shape).toMatchObject({ k: 'num', q: { v: 4 } });
    target.run('修改', () => target.update(input, { k: 'param', name: 'n', value: 7, unit: 'none', showEdit: true }));
    expect(target.results.get(output)?.shape).toMatchObject({ k: 'num', q: { v: 8 } });
    expect(createToolObjects(st.page, [])).toHaveProperty('error');
  });
  it('工具标签选项控制创建工具时是否保留标签', () => {
    const st = new Store(newDoc('标签'));
    let s = 0;
    st.run('构造', () => {
      const a = st.add({ k: 'free', x: 0, y: 0 }), b = st.add({ k: 'free', x: 10, y: 0 });
      const line = st.add({ k: 'seg', a: a.id, b: b.id }, { label: '边', labelShown: true });
      line.toolLabel = true; s = line.id;
    });
    const made = createToolObjects(st.page, [s]);
    if ('error' in made) throw new Error(made.error);
    const tool = buildTool(encodeToolBody(made.objects, '标签', made.prereq), decodeToolBody(encodeToolBody(made.objects, '标签', made.prereq)).page);
    expect(tool.objects.at(-1)).toMatchObject({ label: '边', labelShown: true });
    // 这个选项写在标签记录偏移 4，.gsp 和 .ngsp 都保留。
    const saved = encodeFile(st.doc, undefined);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(decodeFile(saved.bytes, '标签.gsp').doc.pages[0].objects.at(-1)?.toolLabel).toBe(true);
    expect(decodeFile(encodeNgsp(st.doc), '标签.ngsp').doc.pages[0].objects.at(-1)?.toolLabel).toBe(true);
  });
  it('acceptsInput：点只收点，数值收参数/计算/度量但不收坐标', () => {
    const st = new Store(newDoc('t'));
    let pt = 0, par = 0, co = 0;
    st.run('x', () => {
      const a = st.add({ k: 'free', x: 1, y: 1 }); pt = a.id;
      par = st.add({ k: 'param', name: 't', value: 1, unit: 'none', showEdit: true }, { at: { x: 1, y: 1 } }).id;
      const s = st.add({ k: 'sys', origin: a.id, unitX: a.id, unitY: a.id, axisX: a.id, axisY: a.id, grid: 'square', showGrid: false, snap: false });
      co = st.add({ k: 'measure', m: 'coords', refs: [a.id, s.id] }, { at: { x: 1, y: 1 } }).id;
    });
    expect(acceptsInput('point', st.get(pt)!)).toBe(true);
    expect(acceptsInput('point', st.get(par)!)).toBe(false);
    expect(acceptsInput('number', st.get(par)!)).toBe(true);
    expect(acceptsInput('number', st.get(co)!)).toBe(false);
  });
});
