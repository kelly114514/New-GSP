import { PageGeometryEvaluator, writeGsp } from '@gsp-plus/core';
import type { DocumentModel } from '@gsp-plus/core';
import { loadGspDocument } from './load';

export interface EditorDocument {
  fileName: string;
  openedPath: string;
  lastSavedPath: string | null;
  model: DocumentModel;
}

export interface EditorState {
  document: EditorDocument | null;
  pageIndex: number;
  selected: number | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: 'open' | 'save' | null;
  pendingReplacement: boolean;
  /** Also changes when an external action ends the canvas gesture. */
  dragEpoch: number;
  revision: number;
  error: string | null;
  message: string;
}

export interface EditorFileIO {
  open: () => Promise<{ path: string; bytes: Uint8Array } | null>;
  chooseSavePath: (defaultPath: string) => Promise<string | null>;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
}

interface Point { x: number; y: number }
interface PointEdit { pageIndex: number; objectIndex: number; before: Point; after: Point }
interface PendingOpen { path: string; bytes: Uint8Array; model: DocumentModel }

export function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export function editorTitle(state: Pick<EditorState, 'document' | 'dirty'>): string {
  return state.document === null ? 'GSP-plus' : `GSP-plus - ${state.document.fileName}${state.dirty ? ' *' : ''}`;
}

function samePoint(a: Point, b: Point): boolean { return a.x === b.x && a.y === b.y; }
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** One document owns its history, evaluators and byte checkpoint; React only observes it. */
export class EditorController {
  private state: EditorState = {
    document: null, pageIndex: 0, selected: null, dirty: false, canUndo: false, canRedo: false,
    busy: null, pendingReplacement: false, dragEpoch: 0, revision: 0, error: null, message: '就绪',
  };
  private readonly listeners = new Set<() => void>();
  private readonly evaluators = new Map<number, PageGeometryEvaluator>();
  private checkpoint: Uint8Array = new Uint8Array();
  private undoStack: PointEdit[] = [];
  private redoStack: PointEdit[] = [];
  private drag: PointEdit | null = null;
  private pendingOpen: PendingOpen | null = null;

  constructor(private readonly io: EditorFileIO) {}

  getSnapshot = (): EditorState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getEvaluator(pageIndex = this.state.pageIndex): PageGeometryEvaluator | null {
    const page = this.state.document?.model.pages[pageIndex];
    if (page === undefined) return null;
    let evaluator = this.evaluators.get(pageIndex);
    if (evaluator === undefined) {
      evaluator = new PageGeometryEvaluator(page);
      this.evaluators.set(pageIndex, evaluator);
    }
    return evaluator;
  }

  private publish(patch: Partial<EditorState> = {}, checkBytes = false): void {
    const document = patch.document === undefined ? this.state.document : patch.document;
    this.state = {
      ...this.state, ...patch,
      dirty: document === null ? false : checkBytes || patch.document !== undefined
        ? !sameBytes(writeGsp(document.model.doc), this.checkpoint) : this.state.dirty,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      revision: this.state.revision + (checkBytes || (patch.document !== undefined && document?.model !== this.state.document?.model) ? 1 : 0),
    };
    for (const listener of this.listeners) listener();
  }

  selectObject = (selected: number | null): void => {
    if (!this.state.pendingReplacement) this.publish({ selected });
  };
  clearError = (): void => { this.publish({ error: null }); };

  selectPage = (pageIndex: number): void => {
    if (this.state.pendingReplacement || this.state.document?.model.pages[pageIndex] === undefined) return;
    this.cancelDrag();
    this.publish({ pageIndex, selected: null });
  };

  beginDrag = (objectIndex: number): boolean => {
    if (this.state.pendingReplacement || this.state.document?.model.layout !== 5) return false;
    this.cancelDrag();
    const object = this.state.document?.model.pages[this.state.pageIndex]?.objects.find((o) => o.index === objectIndex);
    if (object?.constraintId !== 0 || object.mainKind !== 1 || object.freePoint === undefined) return false;
    const before = { ...object.freePoint };
    this.drag = { pageIndex: this.state.pageIndex, objectIndex, before, after: { ...before } };
    this.publish({ selected: objectIndex });
    return true;
  };

  previewDrag = (objectIndex: number, x: number, y: number): void => {
    const drag = this.drag;
    if (drag === null || drag.objectIndex !== objectIndex || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const after = { x, y };
    if (samePoint(drag.after, after)) return;
    this.move(drag.pageIndex, objectIndex, after);
    drag.after = after;
    this.publish({ message: '正在移动自由点' }, true);
  };

  commitDrag = (): boolean => {
    const drag = this.drag;
    if (drag === null) return false;
    this.drag = null;
    const changed = !samePoint(drag.before, drag.after);
    if (changed) {
      this.undoStack.push(drag);
      this.redoStack = [];
    }
    this.publish({ dragEpoch: this.state.dragEpoch + 1, message: changed ? '已移动自由点' : this.state.message });
    return changed;
  };

  cancelDrag = (): boolean => {
    const drag = this.drag;
    if (drag === null) return false;
    this.drag = null;
    if (!samePoint(drag.before, drag.after)) this.move(drag.pageIndex, drag.objectIndex, drag.before);
    this.publish({ dragEpoch: this.state.dragEpoch + 1, message: '已取消拖动' }, true);
    return true;
  };

  private move(pageIndex: number, objectIndex: number, point: Point): void {
    const document = this.state.document;
    const evaluator = this.getEvaluator(pageIndex);
    if (document === null || evaluator === null) return;
    evaluator.moveFreePoint(document.model.doc, objectIndex, point.x, point.y);
  }

  undo = (): void => {
    if (this.state.pendingReplacement) return;
    this.cancelDrag();
    const edit = this.undoStack.pop();
    if (edit === undefined) return;
    this.move(edit.pageIndex, edit.objectIndex, edit.before);
    this.redoStack.push(edit);
    this.publish({ pageIndex: edit.pageIndex, selected: edit.objectIndex, message: '已撤销移动自由点' }, true);
  };

  redo = (): void => {
    if (this.state.pendingReplacement) return;
    this.cancelDrag();
    const edit = this.redoStack.pop();
    if (edit === undefined) return;
    this.move(edit.pageIndex, edit.objectIndex, edit.after);
    this.undoStack.push(edit);
    this.publish({ pageIndex: edit.pageIndex, selected: edit.objectIndex, message: '已重做移动自由点' }, true);
  };

  openFile = async (): Promise<void> => {
    if (this.state.busy !== null) return;
    this.publish({ busy: 'open' });
    try {
      const opened = await this.io.open();
      if (opened === null) return;
      const result = loadGspDocument(opened.bytes);
      if (!result.ok) {
        this.publish({ error: result.message, message: '打开失败' });
        return;
      }
      const candidate = { ...opened, model: result.model };
      // Check at replacement time: edits may have happened while reading the candidate.
      if (this.state.dirty) {
        this.pendingOpen = candidate;
        this.publish({ pendingReplacement: true });
      } else this.install(candidate);
    } catch (error) {
      this.publish({ error: `打开失败：${error instanceof Error ? error.message : String(error)}`, message: '打开失败' });
    } finally {
      if (this.pendingOpen === null) this.publish({ busy: null });
    }
  };

  resolveReplacement = (discard: boolean): void => {
    const pending = this.pendingOpen;
    if (pending === null) return;
    this.pendingOpen = null;
    if (discard) this.install(pending);
    this.publish({ pendingReplacement: false, busy: null });
  };

  private install(opened: PendingOpen): void {
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.evaluators.clear();
    this.checkpoint = opened.bytes.slice();
    const fileName = baseName(opened.path);
    this.publish({
      document: { fileName, openedPath: opened.path, lastSavedPath: null, model: opened.model },
      pageIndex: 0, selected: null, dragEpoch: this.state.dragEpoch + 1,
      error: null, message: `已打开 ${fileName}`,
    });
  }

  saveAs = async (): Promise<void> => {
    const document = this.state.document;
    if (document === null || this.state.busy !== null) return;
    this.commitDrag();
    // writeGsp returns detached bytes, so later preview/history edits cannot alter this snapshot.
    const bytes = writeGsp(document.model.doc);
    this.publish({ busy: 'save' });
    try {
      const path = await this.io.chooseSavePath(document.lastSavedPath ?? document.openedPath);
      if (path === null) return;
      if (!/\.gsp$/i.test(path)) throw new Error('请选择以 .gsp 结尾的文件名。');
      await this.io.write(path, bytes);
      this.checkpoint = bytes;
      const fileName = baseName(path);
      this.publish({ document: { ...document, fileName, lastSavedPath: path }, error: null, message: `已另存为 ${fileName}` });
    } catch (error) {
      this.publish({ error: `另存为失败：${error instanceof Error ? error.message : String(error)}。可以继续编辑并重试。`, message: '另存为失败' });
    } finally {
      this.publish({ busy: null });
    }
  };
}
