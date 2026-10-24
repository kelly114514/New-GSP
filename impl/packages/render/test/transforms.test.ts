import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, parseGsp, readDocumentModel, writeGsp, writeU16, writeU32 } from '@gsp-plus/core';
import type { ObjectInfo } from '@gsp-plus/core';
import { buildPageDrawList, drawPageScene, hitTest } from '../src/index';
import { loadSample } from './support/samples';

const view = { scale: 1, offsetX: 0, offsetY: 0 };
function translate(source: ObjectInfo, index: number, dx: number, dy: number): ObjectInfo {
  const payload = new Uint8Array(52), data = new DataView(payload.buffer);
  data.setUint32(0, 17, true); data.setFloat64(4, dx, true); data.setFloat64(24, dy, true);
  return { ...source, index, constraintId: 17, parents: [source.index], node: { ...source.node, records: [{ kind: 2003, payload, pad: 0 }] } };
}

describe('transformed viewer geometry', () => {
  it('draws images with their own color, labels and native segment style, while only free ancestors are draggable', () => {
    const model = loadSample('segment.gsp'), pg = model.pages[0]!;
    const image = translate(pg.objects[2]!, 4, 100, 60);
    image.header = { ...image.header, colorRef: 0x332211 };
    pg.objects.push(image);
    const evaluator = new PageGeometryEvaluator(pg);
    const first = buildPageDrawList(pg, evaluator.evaluate());
    expect(first.items[3]).toMatchObject({ index: 4, kind: 'segment', geometry: { a: [511, 221], b: [311, 87] }, color: 'rgb(17, 34, 51)', draggable: false, style: { lineWidth: 3, nativeStyleVerified: true } });
    expect(hitTest(first, view, 411, 154)).toBe(4);
    const after = buildPageDrawList(pg, evaluator.moveFreePoint(model.doc, 1, 251, 174));
    expect(after.items[3]).toMatchObject({ geometry: { a: [511, 221], b: [351, 114] }, draggable: false });
    expect(evaluator.recomputedIndices).toEqual([1, 3, 4]);
  });
  it('reflected arc direction reaches canvas, and filled reflected regions retain their fill', () => {
    const model = loadSample('segment.gsp'), pg = model.pages[0]!;
    function point(index: number, x: number, y: number): ObjectInfo {
      const source = pg.objects[0]!, payload = new Uint8Array(16), data = new DataView(payload.buffer);
      data.setFloat64(0, x, true); data.setFloat64(8, y, true);
      return { ...source, index, node: { ...source.node, records: [{ kind: 2201, payload, pad: 0 }] } };
    }
    function object(index: number, id: number, parents: number[], mainKind: number, genera: number): ObjectInfo {
      const source = pg.objects[2]!;
      return { ...source, index, constraintId: id, parents, mainKind, genera, node: { ...source.node, records: [] } };
    }
    const synthetic = { ...pg, objects: [point(1, 50, 50), point(2, 70, 50), point(3, 50, 30), object(4, 80, [1, 2, 3], 12, 67), object(5, 2, [1, 2], 2, 14), object(6, 34, [4, 5], 12, 67), object(7, 82, [6], 13, 68)] };
    const fullScene = buildPageDrawList(synthetic);
    const scene = { ...fullScene, items: fullScene.items.filter((item) => item.index === 6 || item.index === 7) };
    const calls: Array<[string, unknown[]]> = [];
    const context = new Proxy({}, { get: (_target, property: string) => (...args: unknown[]) => calls.push([property, args]), set: () => true }) as unknown as CanvasRenderingContext2D;
    drawPageScene(context, scene, view, { width: 100, height: 100 });
    const arcs = calls.filter(([name]) => name === 'arc');
    expect(arcs).toHaveLength(2);
    for (const [, args] of arcs) {
      expect(args.slice(0, 3)).toEqual([50, 50, 20]);
      expect(args[4]).toBeCloseTo(Math.PI / 2, 9);
      expect(args[5]).toBe(false);
    }
    expect(calls.filter(([name]) => name === 'fill')).toHaveLength(1);
    expect(calls.filter(([name]) => name === 'stroke')).toHaveLength(1);
    expect(hitTest(scene, view, 64, 64)).toBe(6);
    expect(hitTest(scene, view, 53, 53)).toBe(7);
    expect(hitTest(scene, view, 64, 36)).toBeNull();
  });
  it('parsed transform records survive an ancestor edit and reopening with the same viewer geometry', () => {
    const model = loadSample('midpoint.gsp'), pg = model.pages[0]!;
    const image = pg.objects[3]!, payload = new Uint8Array(36).fill(0xc9);
    const data = new DataView(payload.buffer);
    data.setUint32(0, 27, true); data.setFloat64(4, -1, true); data.setFloat64(12, 0, true);
    writeU16(image.node.begin.payload, 0, 27);
    const parents = new Uint8Array(12); writeU32(parents, 0, 2); writeU32(parents, 4, 1); writeU32(parents, 8, 2);
    image.node.records = [{ kind: 2002, payload: parents, pad: 0 }, { kind: 2003, payload, pad: 0 }];
    // Re-read the deliberately changed native record tree, as opening a transformed .gsp would.
    // The application uses this evaluator and draw-list path during pointer movement.
    const opened = readDocumentModel(parseGsp(writeGsp(model.doc)));
    const read = new PageGeometryEvaluator(opened.pages[0]!);
    const before = buildPageDrawList(read.page, read.evaluate());
    expect(before.items[3]).toMatchObject({ index: 4, kind: 'point', geometry: { x: 277, y: 481 }, draggable: false });
    const after = buildPageDrawList(read.page, read.moveFreePoint(opened.doc, 1, 251, 174));
    expect(after.items[3]).toMatchObject({ geometry: { x: 304, y: 441 } });
    const reopened = readDocumentModel(parseGsp(writeGsp(opened.doc)));
    expect(buildPageDrawList(reopened.pages[0]!).items[3]).toMatchObject({ geometry: { x: 304, y: 441 } });
    expect(reopened.pages[0]!.objects[3]!.node.records[1]!.payload).toEqual(payload);
  });
});
