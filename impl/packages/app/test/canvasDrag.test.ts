import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, parseGsp, readDocumentModel, writeGsp } from '@gsp-plus/core';
import { buildPageDrawList, worldToScreen } from '@gsp-plus/render';
import { beginFreePointDrag, freePointDragTarget } from '../src/model/canvasDrag';
const samples = fileURLToPath(new URL('../../../../samples/baseline/samples/', import.meta.url));
describe('free point canvas dragging', () => {
  it('preserves grab offset under zoom and updates dependent midpoint and saved bytes', () => {
    const model = readDocumentModel(parseGsp(new Uint8Array(readFileSync(samples + 'midpoint.gsp'))));
    const page = model.pages[0]!;
    const evaluator = new PageGeometryEvaluator(page);
    const view = { scale: 2, offsetX: 11, offsetY: -27 };
    const first = worldToScreen(view, 211, 147);
    const drag = beginFreePointDrag(buildPageDrawList(page, evaluator.evaluate()), view, first.x + 2, first.y - 2)!;
    const target = freePointDragTarget(drag, view, first.x + 82, first.y + 52);
    expect(target).toEqual({ x: 251, y: 174 });
    const result = evaluator.moveFreePoint(model.doc, drag.objectIndex, target.x, target.y);
    expect(result.objects[3]).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    expect(view).toEqual({ scale: 2, offsetX: 11, offsetY: -27 });
    expect(readDocumentModel(parseGsp(writeGsp(model.doc))).pages[0]!.objects[0]!.freePoint).toEqual(target);
  });
  it('constrained midpoint and blank space do not begin a free point drag', () => {
    const model = readDocumentModel(parseGsp(new Uint8Array(readFileSync(samples + 'midpoint.gsp'))));
    const scene = buildPageDrawList(model.pages[0]!);
    const view = { scale: 1, offsetX: 0, offsetY: 0 };
    expect(beginFreePointDrag(scene, view, 311, 214)).toBeNull();
    expect(beginFreePointDrag(scene, view, 0, 0)).toBeNull();
  });
});
