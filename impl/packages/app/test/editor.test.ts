import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  envelopesOf, newRecord, parseGsp, readDocumentModel, setDocHeaderWord, validateDocument, writeGsp, writeU16,
} from '@gsp-plus/core';
import { EditorController, editorTitle } from '../src/model/editor';
import type { EditorFileIO } from '../src/model/editor';

const samples = fileURLToPath(new URL('../../../../samples/baseline/samples/', import.meta.url));
const sample = (name = 'midpoint.gsp') => new Uint8Array(readFileSync(samples + name));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(bytes: Uint8Array = sample()) {
  const open = vi.fn<EditorFileIO['open']>().mockResolvedValue({ path: 'C:\\source\\midpoint.gsp', bytes });
  const chooseSavePath = vi.fn<EditorFileIO['chooseSavePath']>().mockResolvedValue('C:\\saved\\edited.gsp');
  const write = vi.fn<EditorFileIO['write']>().mockResolvedValue();
  const editor = new EditorController({ open, chooseSavePath, write });
  await editor.openFile();
  return { editor, open, chooseSavePath, write, bytes };
}

function edit(editor: EditorController, x: number, y: number, objectIndex = 1) {
  expect(editor.beginDrag(objectIndex)).toBe(true);
  editor.previewDrag(objectIndex, x, y);
  editor.commitDrag();
}
function point(editor: EditorController, page = editor.getSnapshot().pageIndex) {
  return editor.getSnapshot().document!.model.pages[page]!.objects[0]!.freePoint;
}
function bytesOf(editor: EditorController) { return writeGsp(editor.getSnapshot().document!.model.doc); }

/** A valid two-page test document, with opaque odd records at several levels. */
function twoPagesWithUnknownRecords() {
  const doc = parseGsp(sample());
  const page = readDocumentModel(doc).pages[0]!.node;
  const first = envelopesOf(doc).find((envelope) => envelope.items.includes(page))!;
  const second = structuredClone(first);
  doc.items.push(second);
  setDocHeaderWord(doc, 1, 2);
  setDocHeaderWord(doc, 12, envelopesOf(doc).length);
  for (const envelope of [first, second]) {
    envelope.begin.payload = envelope.begin.payload.slice();
    writeU16(envelope.begin.payload, 6, 3);
    writeU16(envelope.begin.payload, 8, 3);
  }
  const model = readDocumentModel(doc);
  const other = model.pages[1]!;
  other.node.begin.payload = other.node.begin.payload.slice();
  writeU16(other.node.begin.payload, 8, model.pages[0]!.header!.pageId + 1);
  model.pages[0]!.node.items.unshift(newRecord(19991, new Uint8Array([3, 7, 9]), 0xa5));
  model.pages[0]!.objects[0]!.node.records.push(newRecord(19992, new Uint8Array([11]), 0x5a));
  doc.items.unshift(newRecord(19993, new Uint8Array([4, 5, 6]), 0x7e));
  expect(validateDocument(doc)).toEqual([]);
  return writeGsp(doc);
}

describe('文档拖动事务与历史', () => {
  it('多次move即时更新中点，pointerup只提交一步，撤销全部恢复原字节', async () => {
    const { editor, bytes } = await fixture();
    expect(editor.beginDrag(1)).toBe(true);
    editor.previewDrag(1, 220, 150);
    editor.previewDrag(1, 240, 165);
    editor.previewDrag(1, 251, 174);
    expect(editor.getEvaluator()!.evaluate().objects[3]).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, dirty: true });
    editor.commitDrag();
    editor.undo();
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true, dirty: false });
    expect(bytesOf(editor)).toEqual(bytes);
    editor.redo();
    expect(point(editor)).toEqual({ x: 251, y: 174 });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('点击不移动和移回起点都不提交历史，也不清redo', async () => {
    const { editor, bytes } = await fixture();
    edit(editor, 251, 174);
    editor.undo();
    editor.beginDrag(1);
    expect(editor.commitDrag()).toBe(false);
    editor.beginDrag(1);
    editor.previewDrag(1, 400, 300);
    editor.previewDrag(1, 211, 147);
    expect(editor.commitDrag()).toBe(false);
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true, dirty: false });
    expect(bytesOf(editor)).toEqual(bytes);
  });

  it.each(['pointercancel', 'Escape', 'lostpointercapture'])('%s恢复起点，不新增历史', async () => {
    const { editor, bytes } = await fixture();
    editor.beginDrag(1);
    editor.previewDrag(1, 251, 174);
    expect(editor.cancelDrag()).toBe(true);
    editor.previewDrag(1, 999, 999); // late pointer event must not revive the canceled gesture
    expect(editor.commitDrag()).toBe(false);
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, canUndo: false, canRedo: false });
    expect(bytesOf(editor)).toEqual(bytes);
  });

  it('撤销先取消进行中的拖动，再撤销之前已提交的一步', async () => {
    const { editor } = await fixture();
    edit(editor, 251, 174);
    editor.beginDrag(1);
    editor.previewDrag(1, 300, 250);
    editor.undo();
    expect(point(editor)).toEqual({ x: 211, y: 147 });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, canRedo: true, dirty: false });
  });

  it('重做先取消进行中的拖动，取消本身保留redo', async () => {
    const { editor } = await fixture();
    edit(editor, 251, 174);
    editor.undo();
    editor.beginDrag(1);
    editor.previewDrag(1, 300, 250);
    editor.redo();
    expect(point(editor)).toEqual({ x: 251, y: 174 });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it('撤销后提交新编辑清空重做分支', async () => {
    const { editor } = await fixture();
    edit(editor, 251, 174);
    editor.undo();
    edit(editor, 280, 200);
    editor.redo();
    expect(point(editor)).toEqual({ x: 280, y: 200 });
    expect(editor.getSnapshot().canRedo).toBe(false);
  });

  it('历史跨页共享，undo/redo自动定位原操作页，切页取消未完成拖动', async () => {
    const { editor, bytes } = await fixture(twoPagesWithUnknownRecords());
    edit(editor, 251, 174);
    editor.selectPage(1);
    edit(editor, 310, 210);
    editor.selectPage(0);
    editor.undo();
    expect(editor.getSnapshot().pageIndex).toBe(1);
    expect(point(editor)).toEqual({ x: 211, y: 147 });
    editor.undo();
    expect(editor.getSnapshot().pageIndex).toBe(0);
    expect(bytesOf(editor)).toEqual(bytes);
    editor.redo();
    editor.redo();
    expect(editor.getSnapshot().pageIndex).toBe(1);
    expect(point(editor)).toEqual({ x: 310, y: 210 });
    editor.beginDrag(1);
    editor.previewDrag(1, 100, 100);
    editor.selectPage(0);
    expect(point(editor, 1)).toEqual({ x: 310, y: 210 });
  });

  it('派生点不提供拖动入口，非有限坐标不写入', async () => {
    const { editor, bytes } = await fixture();
    expect(editor.beginDrag(4)).toBe(false);
    editor.beginDrag(1);
    editor.previewDrag(1, Infinity, 0);
    editor.previewDrag(1, 0, NaN);
    editor.commitDrag();
    expect(bytesOf(editor)).toEqual(bytes);
  });
});

describe('字节检查点与标题', () => {
  it('首次打开逐字节一致；title和dirty依据当前序列化字节', async () => {
    const { editor, bytes } = await fixture();
    expect(bytesOf(editor)).toEqual(bytes);
    expect(editorTitle(editor.getSnapshot())).toBe('GSP-plus - midpoint.gsp');
    edit(editor, 251, 174);
    expect(editorTitle(editor.getSnapshot())).toBe('GSP-plus - midpoint.gsp *');
    editor.undo();
    expect(editorTitle(editor.getSnapshot())).toBe('GSP-plus - midpoint.gsp');
  });

  it('同历史深度不同分支仍为脏；不同历史深度相同字节回到保存检查点', async () => {
    const { editor } = await fixture();
    edit(editor, 251, 174);
    await editor.saveAs();
    expect(editor.getSnapshot().dirty).toBe(false);
    editor.undo();
    expect(editor.getSnapshot().dirty).toBe(true);
    edit(editor, 300, 220);
    expect(editor.getSnapshot().dirty).toBe(true);
    edit(editor, 251, 174);
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, canUndo: true });
    expect(editorTitle(editor.getSnapshot())).toBe('GSP-plus - edited.gsp');
  });
});

describe('另存为事务与重开', () => {
  it('无文档时保存、撤销、重做均不可用', async () => {
    const io = { open: vi.fn(), chooseSavePath: vi.fn(), write: vi.fn() };
    const editor = new EditorController(io);
    await editor.saveAs();
    editor.undo(); editor.redo();
    expect(io.chooseSavePath).not.toHaveBeenCalled();
    expect(editor.getSnapshot()).toMatchObject({ document: null, dirty: false, canUndo: false, canRedo: false });
    expect(editorTitle(editor.getSnapshot())).toBe('GSP-plus');
  });

  it('保存对话框取消保留文档、路径、历史和检查点', async () => {
    const { editor, chooseSavePath, write } = await fixture();
    edit(editor, 251, 174);
    const original = editor.getSnapshot().document;
    chooseSavePath.mockResolvedValueOnce(null);
    await editor.saveAs();
    expect(write).not.toHaveBeenCalled();
    expect(editor.getSnapshot().document).toBe(original);
    expect(editor.getSnapshot()).toMatchObject({ busy: null, dirty: true, canUndo: true });
    editor.undo();
    expect(editor.getSnapshot().dirty).toBe(false);
  });

  it('写失败保留路径和检查点，可继续编辑并成功重试', async () => {
    const { editor, write } = await fixture();
    edit(editor, 251, 174);
    const original = editor.getSnapshot().document;
    write.mockRejectedValueOnce(new Error('磁盘空间不足'));
    await editor.saveAs();
    expect(editor.getSnapshot().document).toBe(original);
    expect(editor.getSnapshot()).toMatchObject({ busy: null, dirty: true, canUndo: true });
    expect(editor.getSnapshot().error).toContain('另存为失败：磁盘空间不足');
    edit(editor, 260, 180);
    await editor.saveAs();
    expect(editor.getSnapshot()).toMatchObject({ error: null, dirty: false });
  });

  it('成功保存只更新最近路径和文件名，原打开路径保留，历史继续可用', async () => {
    const { editor, chooseSavePath } = await fixture();
    edit(editor, 251, 174);
    await editor.saveAs();
    expect(editor.getSnapshot().document).toMatchObject({
      openedPath: 'C:\\source\\midpoint.gsp', lastSavedPath: 'C:\\saved\\edited.gsp', fileName: 'edited.gsp',
    });
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, canUndo: true });
    expect(chooseSavePath).toHaveBeenNthCalledWith(1, 'C:\\source\\midpoint.gsp');
    await editor.saveAs();
    expect(chooseSavePath).toHaveBeenNthCalledWith(2, 'C:\\saved\\edited.gsp');
    editor.undo();
    expect(editor.getSnapshot().dirty).toBe(true);
    editor.redo();
    expect(editor.getSnapshot().dirty).toBe(false);
  });

  it('保存前提交进行中的实际拖动，保存后一次撤销恢复起点', async () => {
    const { editor, write } = await fixture();
    editor.beginDrag(1);
    editor.previewDrag(1, 251, 174);
    await editor.saveAs();
    const saved = readDocumentModel(parseGsp(write.mock.calls[0]![1]));
    expect(saved.pages[0]!.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    expect(editor.commitDrag()).toBe(false);
    editor.undo();
    expect(point(editor)).toEqual({ x: 211, y: 147 });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, dirty: true });
  });

  it('未编辑另存为逐字节相同', async () => {
    const { editor, write, bytes } = await fixture(twoPagesWithUnknownRecords());
    await editor.saveAs();
    expect(write.mock.calls[0]![1]).toEqual(bytes);
  });

  it('midpoint拖动→保存→重开保留对象图、中点、未知记录与未编辑页', async () => {
    const { editor, write, open, bytes } = await fixture(twoPagesWithUnknownRecords());
    const before = readDocumentModel(parseGsp(bytes));
    edit(editor, 251, 174);
    await editor.saveAs();
    const savedBytes = write.mock.calls[0]![1];
    const saved = readDocumentModel(parseGsp(savedBytes));
    expect(validateDocument(saved.doc)).toEqual([]);
    expect(saved.pages[0]!.objects.map((o) => [o.index, o.constraintId, o.parents])).toEqual(
      before.pages[0]!.objects.map((o) => [o.index, o.constraintId, o.parents]),
    );
    expect(saved.pages[1]!.node).toEqual(before.pages[1]!.node);
    expect(saved.doc.items[0]).toEqual(before.doc.items[0]);
    expect(saved.pages[0]!.node.items[0]).toEqual(before.pages[0]!.node.items[0]);
    expect(saved.pages[0]!.objects[0]!.node.records.at(-1)).toEqual(before.pages[0]!.objects[0]!.node.records.at(-1));
    open.mockResolvedValueOnce({ path: 'C:\\saved\\edited.gsp', bytes: savedBytes });
    await editor.openFile();
    expect(point(editor)).toEqual({ x: 251, y: 174 });
    expect(editor.getEvaluator()!.evaluate().objects[3]).toMatchObject({ geometry: { x: 331, y: 227.5 } });
    expect(editor.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false, dirty: false });
  });

  it('对话框期间和写入期间编辑不改变保存快照，重复保存和打开被互斥', async () => {
    const { editor, chooseSavePath, write, open } = await fixture();
    edit(editor, 251, 174);
    const dialog = deferred<string | null>();
    const disk = deferred<void>();
    chooseSavePath.mockReturnValueOnce(dialog.promise);
    write.mockReturnValueOnce(disk.promise);
    const saving = editor.saveAs();
    edit(editor, 300, 220);
    await editor.saveAs();
    await editor.openFile();
    expect(chooseSavePath).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    dialog.resolve('C:\\saved\\snapshot.gsp');
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    const snapshot = write.mock.calls[0]![1];
    expect(readDocumentModel(parseGsp(snapshot)).pages[0]!.objects[0]!.freePoint).toEqual({ x: 251, y: 174 });
    edit(editor, 330, 240);
    disk.resolve();
    await saving;
    expect(point(editor)).toEqual({ x: 330, y: 240 });
    expect(editor.getSnapshot()).toMatchObject({ busy: null, dirty: true });
    editor.undo(); editor.undo();
    expect(editor.getSnapshot().dirty).toBe(false);
    expect(bytesOf(editor)).toEqual(snapshot);
  });

  it('不接受非.gsp目标，也不更新保存路径', async () => {
    const { editor, chooseSavePath, write } = await fixture();
    chooseSavePath.mockResolvedValueOnce('C:\\saved\\wrong.txt');
    await editor.saveAs();
    expect(write).not.toHaveBeenCalled();
    expect(editor.getSnapshot().error).toContain('.gsp');
    expect(editor.getSnapshot().document!.lastSavedPath).toBeNull();
  });
});

describe('打开替换的状态保护', () => {
  it.each(['cancel', 'parse', 'read'])('打开%s保留原文档、历史与dirty', async (failure) => {
    const { editor, open } = await fixture();
    edit(editor, 251, 174);
    edit(editor, 270, 190);
    editor.undo();
    const original = editor.getSnapshot().document;
    const originalBytes = bytesOf(editor);
    if (failure === 'cancel') open.mockResolvedValueOnce(null);
    else if (failure === 'parse') open.mockResolvedValueOnce({ path: 'bad.gsp', bytes: new Uint8Array([1, 2]) });
    else open.mockRejectedValueOnce(new Error('读取失败'));
    await editor.openFile();
    expect(editor.getSnapshot().document).toBe(original);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, canUndo: true, canRedo: true, busy: null, pendingReplacement: false });
    expect(bytesOf(editor)).toEqual(originalBytes);
    editor.redo();
    expect(point(editor)).toEqual({ x: 270, y: 190 });
  });

  it('未保存时必须明确放弃或取消，取消原样保留；放弃安装新历史', async () => {
    const { editor, open, chooseSavePath } = await fixture();
    edit(editor, 251, 174);
    const original = editor.getSnapshot().document;
    open.mockResolvedValue({ path: 'C:\\other\\point.gsp', bytes: sample('point.gsp') });
    await editor.openFile();
    expect(editor.getSnapshot()).toMatchObject({ pendingReplacement: true, busy: 'open', dirty: true });
    await editor.saveAs();
    expect(chooseSavePath).not.toHaveBeenCalled();
    editor.resolveReplacement(false);
    expect(editor.getSnapshot().document).toBe(original);
    expect(editor.getSnapshot()).toMatchObject({ pendingReplacement: false, canUndo: true, dirty: true, busy: null });
    await editor.openFile();
    editor.resolveReplacement(true);
    expect(editor.getSnapshot()).toMatchObject({
      document: { fileName: 'point.gsp', lastSavedPath: null },
      pendingReplacement: false, dirty: false, canUndo: false, canRedo: false, busy: null,
    });
  });

  it('异步读取期间新增编辑也必须确认，打开期间禁止重复打开和保存', async () => {
    const { editor, open, chooseSavePath } = await fixture();
    const reading = deferred<Awaited<ReturnType<EditorFileIO['open']>>>();
    open.mockReturnValueOnce(reading.promise);
    const opening = editor.openFile();
    edit(editor, 251, 174);
    await editor.openFile();
    await editor.saveAs();
    expect(open).toHaveBeenCalledTimes(2);
    expect(chooseSavePath).not.toHaveBeenCalled();
    reading.resolve({ path: 'point.gsp', bytes: sample('point.gsp') });
    await opening;
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, pendingReplacement: true, canUndo: true });
    editor.resolveReplacement(false);
    expect(point(editor)).toEqual({ x: 251, y: 174 });
  });
});
