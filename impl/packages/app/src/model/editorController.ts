import { PageGeometryEvaluator, writeGsp } from '@gsp-plus/core';
import type { DocumentModel } from '@gsp-plus/core';
import { EditHistory } from './history';
import type { HistoryEntry, Point2 } from './history';
import { loadGspDocument } from './load';

/** 文件相关的平台操作。桌面版由 Tauri 实现，浏览器预览对不支持的操作抛出带中文说明的错误。 */
export interface FilePlatform {
  /** 弹出打开对话框并读出字节；用户取消返回 null。 */
  openGsp(): Promise<{ path: string; bytes: Uint8Array } | null>;
  /** 弹出只能选 .gsp 的保存对话框；用户取消返回 null。 */
  chooseSavePath(defaultPath: string | null): Promise<string | null>;
  /** 把字节写到选定路径。 */
  writeGsp(path: string, bytes: Uint8Array): Promise<void>;
  /** 当前文档有未保存修改而要被替换时询问用户：true = 放弃修改，false = 取消。 */
  confirmDiscard(fileName: string): Promise<boolean>;
}

export interface OpenDocumentInfo {
  fileName: string;
  /** 最近一次成功保存的路径，没有保存过则是原打开路径。 */
  path: string;
  openedPath: string;
  savedPath: string | null;
  model: DocumentModel;
}

export interface EditorState {
  doc: OpenDocumentInfo | null;
  pageIndex: number;
  selected: number | null;
  /** 当前文档被编辑的次数计数，几何变化时递增（换文档时从 0 重新开始）。 */
  revision: number;
  /** 当前写出字节与最近成功打开/保存的检查点字节不一致。 */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: 'open' | 'save' | null;
  dragActive: boolean;
  error: string | null;
  message: string;
}

interface Session {
  fileName: string;
  openedPath: string;
  savedPath: string | null;
  model: DocumentModel;
  checkpoint: Uint8Array;
  history: EditHistory;
  evaluators: Map<number, PageGeometryEvaluator>;
  revision: number;
  /** 修改状态的缓存：同一 revision 和同一检查点下不重复写出比较。 */
  dirtyFor: { revision: number; checkpoint: Uint8Array; value: boolean } | null;
}

interface DragTransaction {
  page: number;
  object: number;
  /** 本次事务的起点（pointerdown 时的坐标；保存前提交过一次进度后是那次提交点）。 */
  start: Point2;
  current: Point2;
}

/** 路径的最后一段（Windows 反斜杠和正斜杠都认）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const BUSY_MESSAGE = '正在进行另一个打开或保存操作，请稍候';

/**
 * 编辑器状态机：文档、跨页历史、拖动事务、修改状态、打开与另存为。
 * 不依赖 DOM 与 React，界面通过 subscribe/getState 取状态，平台操作由 FilePlatform 注入。
 */
export class EditorController {
  private session: Session | null = null;
  private drag: DragTransaction | null = null;
  private busy: 'open' | 'save' | null = null;
  private pageIndex = 0;
  private selected: number | null = null;
  private error: string | null = null;
  private message = '就绪';
  private readonly listeners = new Set<() => void>();
  private state: EditorState;
  private docInfo: OpenDocumentInfo | null = null;

  constructor(private readonly platform: FilePlatform) {
    this.state = this.buildState();
  }

  // ---- 订阅 ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): EditorState => this.state;

  private emit(): void {
    this.state = this.buildState();
    for (const listener of [...this.listeners]) listener();
  }

  private buildState(): EditorState {
    const s = this.session;
    return {
      doc: this.currentDocInfo(s),
      pageIndex: this.pageIndex,
      selected: this.selected,
      revision: s?.revision ?? 0,
      dirty: s !== null && this.isDirty(s),
      canUndo: s?.history.canUndo ?? false,
      canRedo: s?.history.canRedo ?? false,
      busy: this.busy,
      dragActive: this.drag !== null,
      error: this.error,
      message: this.message,
    };
  }

  /** 文档信息对象：内容没变时保持同一个引用，方便界面用引用比较。 */
  private currentDocInfo(s: Session | null): OpenDocumentInfo | null {
    if (s === null) return (this.docInfo = null);
    const info = this.docInfo;
    if (
      info !== null &&
      info.model === s.model &&
      info.fileName === s.fileName &&
      info.openedPath === s.openedPath &&
      info.savedPath === s.savedPath
    ) {
      return info;
    }
    return (this.docInfo = {
      fileName: s.fileName,
      path: s.savedPath ?? s.openedPath,
      openedPath: s.openedPath,
      savedPath: s.savedPath,
      model: s.model,
    });
  }

  /** 当前写出字节与检查点字节是否不同（按 revision 缓存，避免无关刷新重复写出）。 */
  private isDirty(s: Session): boolean {
    const cache = s.dirtyFor;
    if (cache !== null && cache.revision === s.revision && cache.checkpoint === s.checkpoint) return cache.value;
    const value = !bytesEqual(writeGsp(s.model.doc), s.checkpoint);
    s.dirtyFor = { revision: s.revision, checkpoint: s.checkpoint, value };
    return value;
  }

  // ---- 页与选择 ----

  /** 当前文档某一页的求值器；每页只建一个，所有编辑都经过它。 */
  evaluatorFor(pageIndex: number): PageGeometryEvaluator | null {
    const s = this.session;
    const page = s?.model.pages[pageIndex];
    if (s === null || page === undefined) return null;
    let evaluator = s.evaluators.get(pageIndex);
    if (evaluator === undefined) s.evaluators.set(pageIndex, (evaluator = new PageGeometryEvaluator(page)));
    return evaluator;
  }

  selectPage(index: number): void {
    if (this.session === null || index === this.pageIndex) return;
    this.cancelDragSilently();
    this.pageIndex = index;
    this.selected = null;
    this.emit();
  }

  select(index: number | null): void {
    if (index === this.selected) return;
    this.selected = index;
    this.emit();
  }

  dismissError(): void {
    if (this.error === null) return;
    this.error = null;
    this.emit();
  }

  // ---- 拖动事务 ----

  get dragActive(): boolean {
    return this.drag !== null;
  }

  private freePointOf(s: Session, page: number, object: number): Point2 | undefined {
    const p = s.model.pages[page]?.objects.find((o) => o.index === object)?.freePoint;
    return p === undefined ? undefined : { x: p.x, y: p.y };
  }

  private applyPoint(s: Session, page: number, object: number, p: Point2): void {
    const evaluator = this.evaluatorFor(page);
    if (evaluator === null) throw new RangeError(`page ${page} does not exist`);
    evaluator.moveFreePoint(s.model.doc, object, p.x, p.y);
    s.revision += 1;
  }

  /** pointerdown：记录当前页该自由点的原坐标。不能拖动时返回 false。 */
  beginDrag(object: number): boolean {
    const s = this.session;
    if (s === null) return false;
    this.cancelDragSilently();
    const start = this.freePointOf(s, this.pageIndex, object);
    if (start === undefined) {
      this.emit();
      return false;
    }
    this.drag = { page: this.pageIndex, object, start, current: { ...start } };
    this.emit();
    return true;
  }

  /** pointermove：即时预览（改文档并重算），但不进历史。事务已不存在时返回 false。 */
  moveDrag(object: number, x: number, y: number): boolean {
    const s = this.session;
    const drag = this.drag;
    if (s === null || drag === null || drag.object !== object) return false;
    try {
      this.applyPoint(s, drag.page, drag.object, { x, y });
      drag.current = { x, y };
      this.message = '正在移动自由点';
    } catch (e) {
      this.restoreDragStart(s, drag);
      this.drag = null;
      this.error = `无法移动该对象：${errorText(e)}`;
    }
    this.emit();
    return this.drag !== null;
  }

  /** pointerup：实际坐标有变化才提交一条历史；移回起点不提交。返回是否提交了历史。 */
  endDrag(): boolean {
    const s = this.session;
    const drag = this.drag;
    if (s === null || drag === null) return false;
    this.drag = null;
    const changed = this.commitDrag(s, drag);
    if (changed) this.message = '已移动自由点';
    this.emit();
    return changed;
  }

  /** pointercancel / Escape / 失去指针捕获：恢复起点，不进历史。 */
  cancelDrag(): boolean {
    if (this.drag === null) return false;
    this.cancelDragSilently();
    this.message = '已取消拖动';
    this.emit();
    return true;
  }

  private commitDrag(s: Session, drag: DragTransaction): boolean {
    if (drag.current.x === drag.start.x && drag.current.y === drag.start.y) return false;
    s.history.push({ page: drag.page, object: drag.object, before: drag.start, after: drag.current });
    return true;
  }

  private restoreDragStart(s: Session, drag: DragTransaction): void {
    const now = this.freePointOf(s, drag.page, drag.object);
    if (now !== undefined && now.x === drag.start.x && now.y === drag.start.y) return;
    try {
      this.applyPoint(s, drag.page, drag.object, drag.start);
    } catch {
      // 对象一直存在且是自由点，恢复不会失败；忽略以免掩盖原错误
    }
  }

  /** 恢复起点并丢弃事务，不发通知（调用方负责 emit）。 */
  private cancelDragSilently(): void {
    const drag = this.drag;
    if (drag === null) return;
    this.drag = null;
    if (this.session !== null) this.restoreDragStart(this.session, drag);
  }

  /** 保存/打开前：把进行中的拖动已发生的变动提交成一步历史，拖动本身继续（起点前移到提交点）。 */
  private commitDragProgress(): void {
    const s = this.session;
    const drag = this.drag;
    if (s === null || drag === null) return;
    if (this.commitDrag(s, drag)) drag.start = { ...drag.current };
  }

  // ---- 撤销 / 重做 ----

  undo(): boolean {
    return this.step('undo');
  }

  redo(): boolean {
    return this.step('redo');
  }

  private step(kind: 'undo' | 'redo'): boolean {
    const s = this.session;
    if (s === null) return false;
    this.cancelDragSilently(); // 进行中的拖动先取消，再处理历史
    const entry: HistoryEntry | null = kind === 'undo' ? s.history.undo() : s.history.redo();
    if (entry === null) {
      this.emit();
      return false;
    }
    const target = kind === 'undo' ? entry.before : entry.after;
    try {
      this.applyPoint(s, entry.page, entry.object, target);
    } catch (e) {
      // 历史项与文档对不上（不应发生）：把游标退回去，避免状态错位
      if (kind === 'undo') s.history.redo();
      else s.history.undo();
      this.error = `${kind === 'undo' ? '撤销' : '重做'}失败：${errorText(e)}`;
      this.emit();
      return false;
    }
    this.pageIndex = entry.page;
    this.selected = entry.object;
    this.message = kind === 'undo' ? '已撤销移动自由点' : '已重做移动自由点';
    this.emit();
    return true;
  }

  // ---- 打开 ----

  /** 文件 → 打开…。取消、失败、被拒绝都保持原文档、历史与修改状态。返回是否换成了新文档。 */
  async openFile(): Promise<boolean> {
    if (this.busy !== null) {
      this.message = BUSY_MESSAGE;
      this.emit();
      return false;
    }
    this.busy = 'open';
    this.emit();
    try {
      const opened = await this.platform.openGsp();
      if (opened === null) {
        this.message = '已取消打开';
        return false;
      }
      const result = loadGspDocument(opened.bytes);
      if (!result.ok) {
        this.error = result.message;
        this.message = '打开失败';
        return false;
      }
      const checkpoint = writeGsp(result.model.doc);
      if (!(await this.confirmReplace())) {
        this.message = '已取消打开';
        return false;
      }
      this.cancelDragSilently();
      const fileName = baseName(opened.path);
      this.session = {
        fileName,
        openedPath: opened.path,
        savedPath: null,
        model: result.model,
        checkpoint,
        history: new EditHistory(),
        evaluators: new Map(),
        revision: 0,
        dirtyFor: null,
      };
      this.pageIndex = 0;
      this.selected = null;
      this.error = null;
      this.message = `已打开 ${fileName}`;
      return true;
    } catch (e) {
      this.error = `打开失败：${errorText(e)}`;
      this.message = '打开失败';
      return false;
    } finally {
      this.busy = null;
      this.emit();
    }
  }

  /** 替换前确认：有未保存修改时让用户选择放弃或取消；等待期间文档又被改过则重新询问。 */
  private async confirmReplace(): Promise<boolean> {
    for (;;) {
      this.commitDragProgress();
      const s = this.session;
      if (s === null || !this.isDirty(s)) return true;
      const revision = s.revision;
      const discard = await this.platform.confirmDiscard(s.fileName);
      if (!discard) return false;
      if (s.revision === revision) return true;
    }
  }

  // ---- 另存为 ----

  /** 文件 → 另存为…。返回是否保存成功。 */
  async saveAs(): Promise<boolean> {
    const s = this.session;
    if (s === null) {
      this.message = '没有可保存的文档';
      this.emit();
      return false;
    }
    if (this.busy !== null) {
      this.message = BUSY_MESSAGE;
      this.emit();
      return false;
    }
    this.busy = 'save';
    this.commitDragProgress();
    // 快照在对话框之前确定：写出的文件就是这份字节，成功后它也成为新的检查点。
    let snapshot: Uint8Array;
    try {
      snapshot = writeGsp(s.model.doc);
    } catch (e) {
      this.busy = null;
      this.error = `另存为失败：${errorText(e)}`;
      this.message = '另存为失败';
      this.emit();
      return false;
    }
    this.emit();
    try {
      const target = await this.platform.chooseSavePath(s.savedPath ?? s.openedPath);
      if (target === null) {
        this.message = '已取消另存为';
        return false;
      }
      if (!/\.gsp$/i.test(target)) {
        this.error = `另存为失败：只能保存为 .gsp 文件（${baseName(target)}）。文档没有改动，请重新选择文件名。`;
        this.message = '另存为失败';
        return false;
      }
      await this.platform.writeGsp(target, snapshot);
      s.savedPath = target;
      s.fileName = baseName(target);
      s.checkpoint = snapshot;
      s.dirtyFor = null;
      this.error = null;
      this.message = `已保存 ${s.fileName}`;
      return true;
    } catch (e) {
      this.error = `另存为失败：${errorText(e)}。文档与历史未受影响，可以重试或换一个位置。`;
      this.message = '另存为失败';
      return false;
    } finally {
      this.busy = null;
      this.emit();
    }
  }
}
