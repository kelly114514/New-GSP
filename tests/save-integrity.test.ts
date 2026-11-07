import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeGsp, decodeFile, encodeGsp, encodeFile, encodeNgsp } from '../src/gsp/codec';
import { compareContent, sourceSnapshot } from '../src/gsp/semantic';
import { defaultStyle, newDoc, type Doc, type Def } from '../src/core/model';

function pointDoc() {
  const doc = newDoc('保存回归');
  const def: Def = { k: 'free', x: 100, y: 120 };
  doc.pages[0].objects.push({ id: 10, def, style: defaultStyle(def), hidden: false, labelShown: true, label: 'A' });
  doc.pages[0].nextId = 11;
  return doc;
}
function rejectWithoutLoss(doc: Doc, path: string) {
  const saved = encodeFile(doc, undefined);
  expect(saved.ok).toBe(false);
  if (!saved.ok) expect(saved.unsupported).toContain(path);
  expect(decodeFile(encodeNgsp(doc), '完整.ngsp').doc).toEqual(doc);
}

describe('保存完整性与失败保护', () => {
  it('旋转图片的完整仿射矩阵往返，导函数来源不能静默降级', () => {
    const doc = newDoc('图片');
    const image: Def = { k: 'image', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSxkAAAAASUVORK5CYII=', mime: 'image/png', at: { x: 70, y: 30 }, w: 30, h: 40, affine: [0, -30, 100, 40, 0, 30] };
    doc.pages[0].objects.push({ id: 1, def: image, style: defaultStyle(image), hidden: false, labelShown: false });
    expect(decodeGsp(encodeGsp(doc)).doc.pages[0].objects[0].def).toEqual(image);
    const f: Def = { k: 'func', name: 'f', param: 'x', expr: { t: 'x' }, derivativeOf: 1 };
    doc.pages[0].objects.push({ id: 2, def: f, style: defaultStyle(f), hidden: false, labelShown: false });
    expect(() => encodeGsp(doc)).toThrow('保留来源关系的导函数');
  });
  it('可编辑导入文件未修改时原样另存，改名及切换视图也不重编码', () => {
    const bytes = encodeGsp(pointDoc()), imported = decodeGsp(bytes);
    imported.doc.name = '另一个文件名';
    imported.doc.pages[0].scroll = { x: 200, y: 100 };
    const saved = encodeFile(imported.doc, imported.source);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.bytes).toEqual(bytes);
  });
  it('修改不复用旧字节，撤销至导入内容后恢复原样输出', () => {
    const bytes = encodeGsp(pointDoc()), imported = decodeGsp(bytes);
    const def = imported.doc.pages[0].objects[0].def;
    if (def.k !== 'free') throw new Error('点');
    def.x += 20;
    const saved = encodeFile(imported.doc, imported.source);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.bytes).not.toEqual(bytes);
      expect(decodeGsp(saved.bytes).doc.pages[0].objects[0].def).toEqual(def);
      expect(encodeFile(imported.doc, saved.source)).toMatchObject({ ok: true, bytes: saved.bytes });
    }
    def.x -= 20;
    expect(encodeFile(imported.doc, imported.source)).toMatchObject({ ok: true, bytes });
  });
  it('只读来源也校验快照，意外修改不能用旧字节冒充已保存', () => {
    const imported = decodeGsp(encodeGsp(pointDoc()));
    imported.source.protectedReason = '测试只读保护';
    expect(encodeFile(imported.doc, imported.source).ok).toBe(true);
    imported.doc.pages[0].objects[0].label = '修改';
    expect(encodeFile(imported.doc, imported.source).ok).toBe(false);
  });
  it('模型外记录保留：已知定长字段可编辑，其它变化转存新版格式', () => {
    const plain = encodeGsp(pointDoc());
    const extra = new Uint8Array(12), v = new DataView(extra.buffer);
    v.setUint32(0, 4, true); v.setUint32(4, 9008, true); v.setUint32(8, 42, true);
    const bytes = new Uint8Array(plain.length + extra.length);
    bytes.set(plain.subarray(0, plain.length - 8));
    bytes.set(extra, plain.length - 8); bytes.set(plain.subarray(plain.length - 8), plain.length - 8 + extra.length);
    const imported = decodeGsp(bytes);
    expect(encodeFile(imported.doc, imported.source)).toMatchObject({ ok: true, bytes });
    const point = imported.doc.pages[0].objects[0];
    if (point.def.k !== 'free') throw new Error('点');
    point.def.x += 10; point.style.color = '#123456';
    const moved = encodeFile(imported.doc, imported.source);
    expect(moved.ok).toBe(true);
    if (!moved.ok) throw new Error(moved.reason);
    expect(decodeGsp(moved.bytes).doc.pages[0].objects[0]).toMatchObject({ def: { x: 110 }, style: { color: '#123456' } });
    expect(moved.bytes.slice(-20, -8)).toEqual(extra); // 未理解的记录逐字节保留
    imported.doc.pages[0].objects[0].label = '新标签';
    expect(encodeFile(imported.doc, imported.source)).toMatchObject({ ok: false, unsupported: ['来源课件含有尚不能确认完整保留的格式信息'] });
    expect(decodeFile(encodeNgsp(imported.doc), '修改.ngsp').doc).toEqual(imported.doc);
  });
  it('标签偏移尚无可靠原版写入依据时，保存前拒绝并可完整转存', () => {
    const doc = pointDoc();
    doc.pages[0].objects[0].labelDx = 80;
    doc.pages[0].objects[0].labelDy = 60;
    rejectWithoutLoss(doc, 'pages.0.objects.0.labelDx');
  });
  it('显示精度、背景和纸型等不能写成原版格式时拒绝', () => {
    const doc = pointDoc();
    doc.settings.display = { angleUnit: 'deg', anglePrec: 4, distUnit: 'cm', distPrec: 3, otherPrec: 5, background: '#ffff00', selected: '#d000d0', mathItalic: true };
    rejectWithoutLoss(doc, 'settings.display');
    delete doc.settings.display;
    doc.paper.landscape = true;
    rejectWithoutLoss(doc, 'paper.landscape');
  });
  it('属性顺序和页内ID重编号无差异，扫描所有对象和字段', () => {
    const doc = pointDoc(), back = decodeGsp(encodeGsp(doc)).doc;
    expect(compareContent(doc, back)).toEqual([]);
    back.pages[0].objects[0].def = { y: 120, x: 100, k: 'free' };
    expect(compareContent(doc, back)).toEqual([]);
    back.pages[0].objects[0].style.color = '#000000';
    back.pages[0].objects[0].hidden = true;
    back.settings.autoLabelPoints = true;
    expect(compareContent(doc, back).map(d => d.path)).toEqual(expect.arrayContaining(['pages.0.objects.0.style.color', 'pages.0.objects.0.hidden', 'settings.autoLabelPoints']));
  });
  it('稀疏ID的依赖引用重编号，不误报为构造损坏', () => {
    const doc = pointDoc(), p = doc.pages[0];
    const d: Def = { k: 'free', x: 300, y: 120 }, seg: Def = { k: 'seg', a: 10, b: 30 };
    p.objects.push({ id: 30, def: d, style: defaultStyle(d), hidden: false, labelShown: false }, { id: 90, def: seg, style: defaultStyle(seg), hidden: false, labelShown: false });
    expect(encodeFile(doc, undefined).ok).toBe(true);
  });
  it('工具元数据、页名及自定义变换引用也纳入比较', () => {
    const a = pointDoc(), b = structuredClone(a);
    b.tools = [{ name: '测试工具', prereq: [1], data: 'AA==' }];
    b.pages[0].name = '第二名称';
    b.pages[0].transforms = [{ name: '变换', src: 10, img: 10 }];
    const paths = compareContent(a, b).map(d => d.path);
    expect(paths).toContain('tools.0');
    expect(paths).toContain('pages.0.name');
    expect(paths).toContain('pages.0.transforms.0');
    expect(sourceSnapshot(a)).not.toEqual(sourceSnapshot(b));
  });
});

const root = resolve(import.meta.dirname, '../..');
const reportPath = resolve(root, 'new-GSP/docs/sample-report.json');
const haveSamples = existsSync(resolve(root, 'sketchpad5')) && existsSync(reportPath);
describe.skipIf(!haveSamples)('审查文档的原课件最小复现（只读样例）', () => {
  const suffixes = ['运动方向(inRm).gsp', '(inRm)太极图.gsp', '七星彩选号.gsp', '平移正弦线作正弦函数图像.gsp'];
  for (const suffix of suffixes) it(suffix, () => {
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { rows: { file: string }[] };
    const row = report.rows.find(r => r.file.endsWith(suffix));
    if (!row) throw new Error(`没有样例：${suffix}`);
    const bytes = new Uint8Array(readFileSync(resolve(root, 'sketchpad5', row.file)));
    const imported = decodeGsp(bytes);
    expect(encodeFile(imported.doc, imported.source)).toMatchObject({ ok: true, bytes });
    // 强制重编码，避免原样输出掩盖定义错误。
    const back = decodeGsp(encodeGsp(imported.doc)).doc;
    expect(compareContent(imported.doc, back).filter(d => d.path.includes('.def.'))).toEqual([]);
    const guarded = encodeFile(imported.doc, undefined);
    if (compareContent(imported.doc, back).length) expect(guarded.ok).toBe(false);
  });
});
