import { describe, expect, it } from 'vitest';
import { PageGeometryEvaluator, parseGsp, readDocumentModel, writeGsp } from '@gsp-plus/core';
import { EditorController, baseName } from '../src/model/editorController';
import { FakePlatform, UNKNOWN_KIND, UNKNOWN_PAYLOAD, deferred, sampleBytes, twoPageBytes } from './support/fixtures';

const MIDPOINT = 'midpoint.gsp';

/** 打开一份字节，返回控制器和假平台。 */
async function openDoc(bytes: Uint8Array = sampleBytes(MIDPOINT), path = 'C:\\题目\\midpoint.gsp') {
  const platform = new FakePlatform();
  const c = new EditorController(platform);
  platform.openResult = async () => ({ path, bytes });
  expect(await c.openFile()).toBe(true);
  return { c, platform, original: bytes };
}

/** 完整拖动：按下、依次移动、抬起。返回是否提交了历史。 */
function drag(c: EditorController, object: number, ...points: [number, number][]): boolean {
  expect(c.beginDrag(object)).toBe(true);
  for (const [x, y] of points) expect(c.moveDrag(object, x, y)).toBe(true);
  return c.endDrag();
}

function freePoint(c: EditorController, page: number, object: number) {
  return c.getState().doc!.model.pages[page]!.objects.find((o) => o.index === object)!.freePoint;
}

function currentBytes(c: EditorController): Uint8Array {
  return writeGsp(c.getState().doc!.model.doc);
}

function geometryOf(c: EditorController, page: number, objectIndex: number) {
  return c.evaluatorFor(page)!.evaluate().objects[objectIndex - 1];
}

describe('拖动事务', () => {
  it('多次 move 只记一步历史，起点来自 pointerdown', async () => {
    const { c } = await openDoc();
    expect(drag(c, 1, [220, 150], [230, 160], [251, 174])).toBe(true);
    expect(c.getState().canUndo).toBe(true);
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    expect(c.undo()).toBe(true);
    expect(c.getState().canUndo).toBe(false); // 一次撤销就回到了起点：只有一步
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
  });

  it('预览阶段即时更新几何但不进历史，抬起才提交', async () => {
    const { c } = await openDoc();
    c.beginDrag(1);
    c.moveDrag(1, 251, 174);
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    expect(c.getState().canUndo).toBe(false);
    expect(c.getState().dragActive).toBe(true);
    expect(c.getState().dirty).toBe(true);
    c.endDrag();
    expect(c.getState().canUndo).toBe(true);
    expect(c.getState().dragActive).toBe(false);
  });

  it('没有移动（按下立刻抬起）不新增历史', async () => {
    const { c } = await openDoc();
    expect(c.beginDrag(1)).toBe(true);
    expect(c.endDrag()).toBe(false);
    expect(c.getState().canUndo).toBe(false);
    expect(c.getState().dirty).toBe(false);
  });

  it('移动后又回到起点不新增历史', async () => {
    const { c, original } = await openDoc();
    expect(drag(c, 1, [300, 300], [211, 147])).toBe(false);
    expect(c.getState().canUndo).toBe(false);
    expect(c.getState().dirty).toBe(false);
    expect(currentBytes(c)).toEqual(original);
  });

  it('pointercancel（cancelDrag）恢复起点且不进历史', async () => {
    const { c, original } = await openDoc();
    c.beginDrag(1);
    c.moveDrag(1, 300, 300);
    expect(c.cancelDrag()).toBe(true);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 311, y: 214 } });
    expect(c.getState().canUndo).toBe(false);
    expect(c.getState().dirty).toBe(false);
    expect(currentBytes(c)).toEqual(original);
    // 取消后手势里余下的 move 和 up 不再起作用
    expect(c.moveDrag(1, 400, 400)).toBe(false);
    expect(c.endDrag()).toBe(false);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
  });

  it('取消没有进行中的拖动时什么也不做', async () => {
    const { c } = await openDoc();
    expect(c.cancelDrag()).toBe(false);
  });

  it('二次拖动的起点是上一次提交的位置', async () => {
    const { c } = await openDoc();
    drag(c, 1, [251, 174]);
    c.beginDrag(1);
    c.moveDrag(1, 400, 400);
    c.cancelDrag();
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    expect(c.getState().canUndo).toBe(true);
  });

  it('不是自由点的对象不能开始拖动', async () => {
    const { c } = await openDoc();
    expect(c.beginDrag(4)).toBe(false); // 中点是派生对象
    expect(c.beginDrag(99)).toBe(false);
    expect(c.getState().dragActive).toBe(false);
  });

  it('没有文档时不能拖动', () => {
    const c = new EditorController(new FakePlatform());
    expect(c.beginDrag(1)).toBe(false);
  });
});

describe('撤销与重做', () => {
  it('撤销、重做在坐标与派生中点上往返', async () => {
    const { c } = await openDoc();
    drag(c, 1, [251, 174]);
    expect(c.getState().canRedo).toBe(false);
    c.undo();
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 311, y: 214 } });
    expect(c.getState().canRedo).toBe(true);
    c.redo();
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    expect(c.getState().canRedo).toBe(false);
  });

  it('没有可用动作时返回 false 且不改变状态', async () => {
    const { c } = await openDoc();
    expect(c.undo()).toBe(false);
    expect(c.redo()).toBe(false);
    expect(c.getState().dirty).toBe(false);
  });

  it('撤销后提交新编辑清空重做分支', async () => {
    const { c } = await openDoc();
    drag(c, 1, [251, 174]);
    drag(c, 1, [260, 180]);
    c.undo();
    expect(c.getState().canRedo).toBe(true);
    drag(c, 1, [270, 190]);
    expect(c.getState().canRedo).toBe(false);
    expect(c.redo()).toBe(false);
    expect(freePoint(c, 0, 1)).toEqual({ x: 270, y: 190 });
    c.undo();
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    c.undo();
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(c.getState().canUndo).toBe(false);
  });

  it('进行中的拖动先被取消再处理撤销', async () => {
    const { c } = await openDoc();
    drag(c, 1, [251, 174]);
    c.beginDrag(1);
    c.moveDrag(1, 300, 300);
    c.undo();
    expect(c.getState().dragActive).toBe(false);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 }); // 撤销的是上一步，不是预览
    expect(c.moveDrag(1, 320, 320)).toBe(false);
    expect(c.getState().canRedo).toBe(true);
  });

  it('进行中的拖动先被取消再处理重做', async () => {
    const { c } = await openDoc();
    drag(c, 1, [251, 174]);
    c.undo();
    c.beginDrag(1);
    c.moveDrag(1, 300, 300);
    c.redo();
    expect(c.getState().dragActive).toBe(false);
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
  });

  it('跨页历史：撤销/重做定位到操作所在页，切页不清空历史', async () => {
    const { c } = await openDoc(twoPageBytes());
    expect(c.getState().doc!.model.pages.length).toBe(2);
    drag(c, 1, [251, 174]); // 第一页
    c.selectPage(1);
    drag(c, 1, [100, 100]); // 第二页
    c.selectPage(0);
    expect(c.getState().canUndo).toBe(true);

    c.undo(); // 撤销第二页的操作
    expect(c.getState().pageIndex).toBe(1);
    expect(c.getState().selected).toBe(1);
    expect(freePoint(c, 1, 1)).toEqual({ x: 211, y: 147 });
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    expect(geometryOf(c, 1, 4)).toMatchObject({ geometry: { x: 311, y: 214 } });

    c.undo(); // 再撤销第一页的操作
    expect(c.getState().pageIndex).toBe(0);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });

    c.selectPage(1);
    c.redo(); // 重做第一页的操作：定位回第一页
    expect(c.getState().pageIndex).toBe(0);
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    c.redo();
    expect(c.getState().pageIndex).toBe(1);
    expect(freePoint(c, 1, 1)).toEqual({ x: 100, y: 100 });
    expect(geometryOf(c, 1, 4)).toMatchObject({ geometry: { x: 255.5, y: 190.5 } });
  });

  it('切页时取消进行中的拖动', async () => {
    const { c } = await openDoc(twoPageBytes());
    c.beginDrag(1);
    c.moveDrag(1, 300, 300);
    c.selectPage(1);
    expect(c.getState().dragActive).toBe(false);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(c.getState().dirty).toBe(false);
  });

  it('历史项记录页次、对象序号和前后坐标', async () => {
    const { c } = await openDoc(twoPageBytes());
    c.selectPage(1);
    drag(c, 1, [100, 100]);
    c.undo();
    c.redo();
    expect(freePoint(c, 1, 1)).toEqual({ x: 100, y: 100 });
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
  });
});

describe('修改状态（按字节检查点）', () => {
  it('打开后不脏；编辑后脏；撤销回检查点恢复为不脏且字节还原', async () => {
    const { c, original } = await openDoc();
    expect(c.getState().dirty).toBe(false);
    drag(c, 1, [251, 174]);
    expect(c.getState().dirty).toBe(true);
    drag(c, 1, [260, 180]);
    c.undo();
    expect(c.getState().dirty).toBe(true);
    c.undo();
    expect(c.getState().dirty).toBe(false);
    expect(currentBytes(c)).toEqual(original);
    c.redo();
    expect(c.getState().dirty).toBe(true);
  });

  it('不是按历史深度判断：手动移回原坐标（深度 2）也不脏', async () => {
    const { c, original } = await openDoc();
    drag(c, 1, [251, 174]);
    drag(c, 1, [211, 147]);
    expect(c.getState().canUndo).toBe(true);
    expect(currentBytes(c)).toEqual(original);
    expect(c.getState().dirty).toBe(false);
  });

  it('同样的历史深度、不同分支的内容仍然是脏的', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]); // 深度 1
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    expect(await c.saveAs()).toBe(true); // 检查点 = 分支 A（深度 1）
    expect(c.getState().dirty).toBe(false);
    c.undo(); // 深度 0
    expect(c.getState().dirty).toBe(true);
    drag(c, 1, [300, 200]); // 分支 B，深度又是 1
    expect(c.getState().dirty).toBe(true);
    c.undo();
    c.redo();
    expect(c.getState().dirty).toBe(true);
  });

  it('保存之后撤销/重做相对新检查点判断', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    await c.saveAs();
    c.undo();
    expect(c.getState().dirty).toBe(true);
    c.redo();
    expect(c.getState().dirty).toBe(false);
  });
});

describe('打开', () => {
  it('成功打开后创建新历史并回到第一页', async () => {
    const { c, platform } = await openDoc(twoPageBytes());
    drag(c, 1, [251, 174]);
    c.selectPage(1);
    platform.discard = async () => true;
    platform.openResult = async () => ({ path: 'D:\\x\\other.gsp', bytes: sampleBytes('point.gsp') });
    expect(await c.openFile()).toBe(true);
    const s = c.getState();
    expect(s.doc!.fileName).toBe('other.gsp');
    expect(s.doc!.path).toBe('D:\\x\\other.gsp');
    expect(s.pageIndex).toBe(0);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.dirty).toBe(false);
    expect(c.undo()).toBe(false);
  });

  it('选择对话框取消：原文档、历史与修改状态不变', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    const before = c.getState();
    platform.openResult = async () => null;
    expect(await c.openFile()).toBe(false);
    const after = c.getState();
    expect(after.doc).toBe(before.doc);
    expect(after.dirty).toBe(true);
    expect(after.canUndo).toBe(true);
    expect(platform.discardAsked).toEqual([]); // 取消选择不应该询问放弃修改
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
  });

  it('读取失败（平台抛错）：保持原文档并给出中文错误', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.openResult = async () => {
      throw new Error('读取被拒绝');
    };
    expect(await c.openFile()).toBe(false);
    const s = c.getState();
    expect(s.error).toBe('打开失败：读取被拒绝');
    expect(s.doc!.fileName).toBe('midpoint.gsp');
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
    expect(s.busy).toBeNull();
  });

  it('解析失败：保持原文档、历史与修改状态，且不询问放弃修改', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.openResult = async () => ({ path: 'C:\\bad.gsp', bytes: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(await c.openFile()).toBe(false);
    const s = c.getState();
    expect(s.error).toMatch(/^打开失败：/);
    expect(s.doc!.fileName).toBe('midpoint.gsp');
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
    expect(platform.discardAsked).toEqual([]);
  });

  it('有未保存修改时替换前询问；选择取消则保持原文档', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.openResult = async () => ({ path: 'C:\\other.gsp', bytes: sampleBytes('point.gsp') });
    platform.discard = async () => false;
    expect(await c.openFile()).toBe(false);
    expect(platform.discardAsked).toEqual(['midpoint.gsp']);
    const s = c.getState();
    expect(s.doc!.fileName).toBe('midpoint.gsp');
    expect(s.dirty).toBe(true);
    expect(s.canUndo).toBe(true);
  });

  it('有未保存修改时选择放弃则替换', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.openResult = async () => ({ path: 'C:\\other.gsp', bytes: sampleBytes('point.gsp') });
    platform.discard = async () => true;
    expect(await c.openFile()).toBe(true);
    expect(c.getState().doc!.fileName).toBe('other.gsp');
    expect(c.getState().dirty).toBe(false);
  });

  it('文档没有未保存修改时直接替换，不询问', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    c.undo(); // 回到检查点，历史里仍有可重做项，但内容未改
    platform.openResult = async () => ({ path: 'C:\\other.gsp', bytes: sampleBytes('point.gsp') });
    expect(await c.openFile()).toBe(true);
    expect(platform.discardAsked).toEqual([]);
  });

  it('等待确认期间文档又被改过：重新询问', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.openResult = async () => ({ path: 'C:\\other.gsp', bytes: sampleBytes('point.gsp') });
    let asked = 0;
    platform.discard = async () => {
      asked += 1;
      if (asked === 1) drag(c, 1, [300, 300]); // 用户在确认框弹出期间又拖了一次
      return true;
    };
    expect(await c.openFile()).toBe(true);
    expect(asked).toBe(2);
  });

  it('打开进行中再次打开或另存为都被阻止', async () => {
    const { c, platform } = await openDoc();
    const gate = deferred<{ path: string; bytes: Uint8Array } | null>();
    platform.openResult = () => gate.promise;
    const first = c.openFile();
    expect(c.getState().busy).toBe('open');
    expect(await c.openFile()).toBe(false);
    expect(await c.saveAs()).toBe(false);
    expect(platform.openCalls).toBe(2); // 一次是 openDoc 里的，一次是 first；被阻止的没有到达平台
    expect(platform.saveDefaults).toEqual([]);
    gate.resolve(null);
    await first;
    expect(c.getState().busy).toBeNull();
  });

  it('文件名取路径最后一段', () => {
    expect(baseName('C:\\a\\b\\c.gsp')).toBe('c.gsp');
    expect(baseName('/a/b/c.gsp')).toBe('c.gsp');
    expect(baseName('c.gsp')).toBe('c.gsp');
  });
});

describe('另存为', () => {
  it('没有文档时不能另存为，也不打开对话框', async () => {
    const platform = new FakePlatform();
    const c = new EditorController(platform);
    expect(await c.saveAs()).toBe(false);
    expect(platform.saveDefaults).toEqual([]);
    expect(c.undo()).toBe(false);
    expect(c.redo()).toBe(false);
  });

  it('保存对话框取消：路径、文件名、检查点都不变', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.saveTarget = async () => null;
    expect(await c.saveAs()).toBe(false);
    const s = c.getState();
    expect(s.error).toBeNull();
    expect(s.doc!.path).toBe('C:\\题目\\midpoint.gsp');
    expect(s.doc!.savedPath).toBeNull();
    expect(s.dirty).toBe(true);
    expect(platform.written).toEqual([]);
    expect(platform.saveDefaults).toEqual(['C:\\题目\\midpoint.gsp']);
  });

  it('选了非 .gsp 目标：拒绝，不写出，给出可恢复错误', async () => {
    const { c, platform } = await openDoc();
    for (const target of ['C:\\out\\a.txt', 'C:\\out\\a', 'C:\\out\\a.gsp.bak', 'C:\\out\\a.emf']) {
      platform.saveTarget = async () => target;
      expect(await c.saveAs()).toBe(false);
      expect(c.getState().error).toContain('只能保存为 .gsp');
    }
    expect(platform.written).toEqual([]);
    expect(c.getState().doc!.fileName).toBe('midpoint.gsp');
    expect(c.getState().busy).toBeNull();
    // 之后仍可正常保存
    platform.saveTarget = async () => 'C:\\out\\ok.GSP';
    expect(await c.saveAs()).toBe(true);
    expect(c.getState().error).toBeNull();
  });

  it('写出失败：路径、文件名、检查点不变，中文错误，画布与历史继续可用', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    platform.writeImpl = async () => {
      throw new Error('磁盘已满');
    };
    expect(await c.saveAs()).toBe(false);
    const s = c.getState();
    expect(s.error).toContain('另存为失败：磁盘已满');
    expect(s.doc!.fileName).toBe('midpoint.gsp');
    expect(s.doc!.path).toBe('C:\\题目\\midpoint.gsp');
    expect(s.doc!.savedPath).toBeNull();
    expect(s.dirty).toBe(true);
    expect(s.busy).toBeNull();
    // 继续编辑、撤销、再保存都可以
    drag(c, 1, [260, 180]);
    expect(c.undo()).toBe(true);
    platform.writeImpl = async () => {};
    expect(await c.saveAs()).toBe(true);
    expect(c.getState().error).toBeNull();
    expect(c.getState().dirty).toBe(false);
  });

  it('成功保存：更新路径、文件名与检查点，写出字节等于当时快照', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    const expected = currentBytes(c);
    platform.saveTarget = async () => 'D:\\新目录\\moved.gsp';
    expect(await c.saveAs()).toBe(true);
    const s = c.getState();
    expect(s.doc!.fileName).toBe('moved.gsp');
    expect(s.doc!.path).toBe('D:\\新目录\\moved.gsp');
    expect(s.doc!.savedPath).toBe('D:\\新目录\\moved.gsp');
    expect(s.doc!.openedPath).toBe('C:\\题目\\midpoint.gsp'); // 保留原打开路径
    expect(s.dirty).toBe(false);
    expect(s.message).toBe('已保存 moved.gsp');
    expect(platform.written).toHaveLength(1);
    expect(platform.written[0]!.path).toBe('D:\\新目录\\moved.gsp');
    expect(platform.written[0]!.bytes).toEqual(expected);
    // 再次另存为时对话框默认从最近保存的路径开始
    platform.saveTarget = async () => null;
    await c.saveAs();
    expect(platform.saveDefaults.at(-1)).toBe('D:\\新目录\\moved.gsp');
  });

  it('保存后历史保留，撤销后相对新检查点为脏', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    await c.saveAs();
    expect(c.getState().canUndo).toBe(true);
    c.undo();
    expect(c.getState().dirty).toBe(true);
  });

  it('重复保存被阻止：第二次调用不到达对话框', async () => {
    const { c, platform } = await openDoc();
    const gate = deferred<void>();
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    platform.writeImpl = () => gate.promise;
    const first = c.saveAs();
    expect(c.getState().busy).toBe('save');
    expect(await c.saveAs()).toBe(false);
    expect(await c.openFile()).toBe(false);
    expect(platform.saveDefaults).toHaveLength(1);
    expect(platform.openCalls).toBe(1);
    gate.resolve();
    expect(await first).toBe(true);
    expect(c.getState().busy).toBeNull();
    expect(platform.written).toHaveLength(1);
  });

  it('保存期间的后续编辑仍标为未保存：写出的是快照', async () => {
    const { c, platform } = await openDoc();
    drag(c, 1, [251, 174]);
    const snapshot = currentBytes(c);
    const gate = deferred<void>();
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    platform.writeImpl = () => gate.promise;
    const saving = c.saveAs();
    drag(c, 1, [300, 200]); // 写出尚未完成时又拖了一次
    expect(c.getState().dirty).toBe(true);
    gate.resolve();
    expect(await saving).toBe(true);
    expect(platform.written[0]!.bytes).toEqual(snapshot);
    expect(c.getState().dirty).toBe(true); // 后续编辑没有被标成已保存
    expect(freePoint(c, 0, 1)).toEqual({ x: 300, y: 200 });
    c.undo();
    expect(c.getState().dirty).toBe(false); // 回到快照那一刻
  });

  it('对话框打开期间的编辑同样不会被误标为已保存', async () => {
    const { c, platform } = await openDoc();
    const gate = deferred<string | null>();
    platform.saveTarget = () => gate.promise;
    const saving = c.saveAs();
    drag(c, 1, [251, 174]);
    gate.resolve('C:\\out\\a.gsp');
    expect(await saving).toBe(true);
    expect(c.getState().dirty).toBe(true);
    expect(platform.written[0]!.bytes).toEqual(sampleBytes(MIDPOINT));
  });

  it('保存前先提交进行中的拖动已发生的变动', async () => {
    const { c, platform } = await openDoc();
    c.beginDrag(1);
    c.moveDrag(1, 251, 174); // 还没抬起
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    expect(await c.saveAs()).toBe(true);
    const saved = readDocumentModel(parseGsp(platform.written[0]!.bytes));
    expect(saved.pages[0]!.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    expect(c.getState().canUndo).toBe(true); // 变动已成为一步历史
    expect(c.getState().dirty).toBe(false);
    // 拖动仍在继续；抬起时没有新的变化，不再追加历史
    expect(c.getState().dragActive).toBe(true);
    c.endDrag();
    c.undo();
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(c.getState().canUndo).toBe(false);
  });

  it('保存后继续拖动，Escape 只回到保存时的位置', async () => {
    const { c, platform } = await openDoc();
    c.beginDrag(1);
    c.moveDrag(1, 251, 174);
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    await c.saveAs();
    c.moveDrag(1, 400, 400);
    c.cancelDrag();
    expect(freePoint(c, 0, 1)).toEqual({ x: 251, y: 174 });
    expect(c.getState().dirty).toBe(false);
  });

  it('保存前有进行中的拖动但没有变化：不产生历史', async () => {
    const { c, platform } = await openDoc();
    c.beginDrag(1);
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    await c.saveAs();
    expect(c.getState().canUndo).toBe(false);
  });

  it('另存为的路径来源：保存过则用最近保存路径', async () => {
    const { c, platform } = await openDoc();
    platform.saveTarget = async () => 'C:\\out\\a.gsp';
    await c.saveAs();
    platform.saveTarget = async () => 'C:\\out\\b.gsp';
    await c.saveAs();
    expect(platform.saveDefaults).toEqual(['C:\\题目\\midpoint.gsp', 'C:\\out\\a.gsp']);
    expect(c.getState().doc!.fileName).toBe('b.gsp');
  });

  it('浏览器预览里不支持的文件操作给出可恢复错误', async () => {
    const platform = new FakePlatform();
    const unsupported = new Error('浏览器预览不支持打开本地文件，请在桌面应用中使用。');
    platform.openResult = async () => {
      throw unsupported;
    };
    const c = new EditorController(platform);
    expect(await c.openFile()).toBe(false);
    expect(c.getState().error).toContain('浏览器预览不支持');
    expect(c.getState().busy).toBeNull();
    // 错误可以关闭，随后仍可重试
    c.dismissError();
    expect(c.getState().error).toBeNull();
    platform.openResult = async () => ({ path: 'C:\\m.gsp', bytes: sampleBytes(MIDPOINT) });
    expect(await c.openFile()).toBe(true);
    // 另存为在浏览器里同样是可恢复错误，文档不受影响
    platform.saveTarget = async () => {
      throw new Error('浏览器预览不支持另存为，请在桌面应用中使用。');
    };
    expect(await c.saveAs()).toBe(false);
    expect(c.getState().error).toContain('浏览器预览不支持另存为');
    expect(c.getState().doc!.fileName).toBe('m.gsp');
    expect(c.getState().busy).toBeNull();
  });

  it('状态订阅：每次变化通知一次且快照稳定', async () => {
    const { c } = await openDoc();
    let calls = 0;
    const off = c.subscribe(() => (calls += 1));
    const before = c.getState();
    expect(c.getState()).toBe(before);
    drag(c, 1, [251, 174]);
    expect(calls).toBeGreaterThan(0);
    expect(c.getState()).not.toBe(before);
    off();
    const n = calls;
    c.undo();
    expect(calls).toBe(n);
  });
});

describe('字节级往返与 midpoint 场景', () => {
  it('未修改文档另存为：逐字节一致', async () => {
    const { c, platform, original } = await openDoc();
    platform.saveTarget = async () => 'C:\\out\\copy.gsp';
    expect(await c.saveAs()).toBe(true);
    expect(platform.written[0]!.bytes).toEqual(original);
  });

  it('撤销全部后写出字节恢复为原字节', async () => {
    const { c, original } = await openDoc(twoPageBytes());
    drag(c, 1, [251, 174]);
    c.selectPage(1);
    drag(c, 1, [100, 100], [120, 90]);
    drag(c, 1, [130, 95]);
    expect(currentBytes(c)).not.toEqual(original);
    while (c.getState().canUndo) c.undo();
    expect(currentBytes(c)).toEqual(original);
    expect(c.getState().dirty).toBe(false);
  });

  it('midpoint：对象 1 从 (211,147) 拖到 (251,174)，中点更新，另存为后重开仍保留', async () => {
    const original = sampleBytes(MIDPOINT);
    const { c, platform } = await openDoc(original);
    expect(freePoint(c, 0, 1)).toEqual({ x: 211, y: 147 });
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 311, y: 214 } });

    expect(drag(c, 1, [230, 160], [251, 174])).toBe(true);
    expect(geometryOf(c, 0, 4)).toMatchObject({ geometry: { x: 331, y: 227.5 } });

    platform.saveTarget = async () => 'C:\\out\\midpoint-moved.gsp';
    expect(await c.saveAs()).toBe(true);
    const saved = platform.written[0]!.bytes;

    // 重新解析：自由点、其余对象图、派生中点
    const reopened = readDocumentModel(parseGsp(saved));
    const originalModel = readDocumentModel(parseGsp(original));
    const page = reopened.pages[0]!;
    expect(page.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    expect(page.objects.length).toBe(originalModel.pages[0]!.objects.length);
    for (const [i, o] of page.objects.entries()) {
      const before = originalModel.pages[0]!.objects[i]!;
      expect(o.constraintId).toBe(before.constraintId);
      expect(o.mainKind).toBe(before.mainKind);
      expect(o.parents).toEqual(before.parents);
      if (i !== 0) expect(o.freePoint).toEqual(before.freePoint); // 只有被拖的点变了
    }
    expect(new PageGeometryEvaluator(page).evaluate().objects[3]).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    // 与样本里原版保存的 midpoint-moved.gsp 的自由点一致
    const moved = readDocumentModel(parseGsp(sampleBytes('midpoint-moved.gsp')));
    expect(moved.pages[0]!.objects[0]!.freePoint).toEqual(page.objects[0]!.freePoint);

    // 保存后的字节只在被拖点的 16 字节载荷上与原文件不同
    expect(saved.length).toBe(original.length);
    let differing = 0;
    for (let i = 0; i < saved.length; i++) if (saved[i] !== original[i]) differing += 1;
    expect(differing).toBeGreaterThan(0);
    expect(differing).toBeLessThanOrEqual(16);

    // 重开后的控制器：干净、历史为空，几何一致
    const platform2 = new FakePlatform();
    const c2 = new EditorController(platform2);
    platform2.openResult = async () => ({ path: 'C:\\out\\midpoint-moved.gsp', bytes: saved });
    await c2.openFile();
    expect(c2.getState().dirty).toBe(false);
    expect(c2.getState().canUndo).toBe(false);
    expect(geometryOf(c2, 0, 4)).toMatchObject({ geometry: { x: 331, y: 227.5 } });
  });

  it('未知记录与未编辑的页在编辑、保存后原样保留', async () => {
    const original = twoPageBytes();
    const { c, platform } = await openDoc(original);
    drag(c, 1, [251, 174]); // 只编辑第一页
    platform.saveTarget = async () => 'C:\\out\\two.gsp';
    expect(await c.saveAs()).toBe(true);
    const saved = platform.written[0]!.bytes;

    const before = parseGsp(original);
    const after = parseGsp(saved);
    // 未知记录仍在第一页，内容不变
    const unknownOf = (doc: ReturnType<typeof parseGsp>) => {
      const found: Uint8Array[] = [];
      const visit = (items: readonly unknown[]) => {
        for (const item of items) {
          const node = item as { kind?: number; payload?: Uint8Array; items?: unknown[] };
          if (node.kind === UNKNOWN_KIND && node.payload !== undefined) found.push(node.payload);
          if (node.items !== undefined) visit(node.items);
        }
      };
      visit(doc.items);
      return found;
    };
    expect(unknownOf(after)).toEqual([UNKNOWN_PAYLOAD]);
    expect(unknownOf(before)).toEqual([UNKNOWN_PAYLOAD]);

    // 第二页字节不变，第一页只有被拖点不同
    const model = readDocumentModel(after);
    const orig = readDocumentModel(before);
    expect(model.pages[0]!.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    expect(model.pages[1]!.objects[0]!.freePoint).toEqual(orig.pages[1]!.objects[0]!.freePoint);
    expect(model.pages.length).toBe(2);
    const second = (m: typeof model) => m.pages[1]!.node;
    expect(writeGspPage(second(model))).toEqual(writeGspPage(second(orig)));
  });
});

/** 只比较某个容器内所有记录的 kind 与载荷。 */
function writeGspPage(node: { items: readonly unknown[] }): string {
  const out: string[] = [];
  const visit = (items: readonly unknown[]) => {
    for (const item of items) {
      const n = item as { kind?: number; payload?: Uint8Array; items?: unknown[]; records?: unknown[] };
      if (n.kind !== undefined && n.payload !== undefined) out.push(`${n.kind}:${Array.from(n.payload).join(',')}`);
      if (n.items !== undefined) visit(n.items);
      if (n.records !== undefined) visit(n.records);
    }
  };
  visit(node.items);
  return out.join('|');
}
