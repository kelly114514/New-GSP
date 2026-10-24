import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGsp, toDebugJson } from '../src/index';
import type { DebugContainer, DebugEnvelope, DebugObject } from '../src/index';
import { baselineSamplesDir, readBytes } from './support';

describe('toDebugJson', () => {
  const doc = parseGsp(readBytes(join(baselineSamplesDir, 'segment.gsp')));
  const dbg = toDebugJson(doc, { hexLimit: 8 });

  it('可 JSON 序列化，带 kind 名称与解码字段', () => {
    expect(() => JSON.stringify(dbg)).not.toThrow();
    expect(dbg.header.name).toBe('doc_begin');
    expect(dbg.header.fields?.['pageCount']).toBe(1);
    expect(dbg.byteLength).toBe(1980);
    expect(dbg.layout).toBe(5);
  });

  it('树形：信封 → 页 → 对象，对象序号从 1 起，2201 显示坐标', () => {
    const envs = dbg.items.filter((i): i is DebugEnvelope => 'type' in i && i.type === 'envelope');
    expect(envs.length).toBe(2);
    const page = envs[1]?.items.find((i): i is DebugContainer => 'type' in i && i.type === 'page')!;
    const objects = page.items.filter((i): i is DebugObject => 'type' in i && i.type === 'object');
    expect(objects.map((o) => o.index)).toEqual([1, 2, 3]);
    const p1 = objects[0]!.records.find((r) => r.kind === 2201)!;
    expect(p1.name).toBe('free_point_xy');
    expect(p1.fields).toEqual({ x: 211, y: 147 });
    const seg = objects[2]!;
    expect(seg.begin.fields?.['constraintId']).toBe(2);
    expect(seg.records.find((r) => r.kind === 2002)?.fields).toEqual({ parents: [2, 1] });
  });

  it('不透明载荷输出十六进制并按上限截断', () => {
    const page = (dbg.items[1] as DebugEnvelope).items.find((i) => 'type' in i && i.type === 'page') as DebugContainer;
    const opaque = page.items.find((i) => !('type' in i) && i.hex !== undefined && i.length > 8);
    expect(opaque).toBeDefined();
    if (opaque && !('type' in opaque)) {
      expect(opaque.hexTruncated).toBe(true);
      expect(opaque.hex?.split(' ').length).toBe(8);
    }
  });
});
