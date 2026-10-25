/** 自由点坐标（页面世界坐标）。 */
export interface Point2 {
  x: number;
  y: number;
}

/** 一步编辑：页次（model.pages 下标，从 0 起）、页内对象序号（从 1 起）、修改前后的坐标。 */
export interface HistoryEntry {
  page: number;
  object: number;
  before: Point2;
  after: Point2;
}

/**
 * 一个文档一份的跨页历史（线性撤销栈）。
 * 撤销后再提交新编辑会丢掉重做分支；切页不影响历史。
 */
export class EditHistory {
  private readonly entries: HistoryEntry[] = [];
  /** 已生效的条目数；entries[cursor..] 是可重做分支。 */
  private cursor = 0;

  /** 已生效的步数（只供显示和测试，不能用来判断文档是否被修改）。 */
  get depth(): number {
    return this.cursor;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  /** 提交一步新编辑，同时清空重做分支。 */
  push(entry: HistoryEntry): void {
    this.entries.length = this.cursor;
    this.entries.push({ ...entry, before: { ...entry.before }, after: { ...entry.after } });
    this.cursor += 1;
  }

  /** 取出要撤销的那一步并后退一格；没有则返回 null。 */
  undo(): HistoryEntry | null {
    if (!this.canUndo) return null;
    this.cursor -= 1;
    return this.entries[this.cursor] ?? null;
  }

  /** 取出要重做的那一步并前进一格；没有则返回 null。 */
  redo(): HistoryEntry | null {
    if (!this.canRedo) return null;
    const entry = this.entries[this.cursor] ?? null;
    this.cursor += 1;
    return entry;
  }

  /** 全部条目（含重做分支），供测试检查。 */
  snapshot(): { applied: HistoryEntry[]; redoable: HistoryEntry[] } {
    return { applied: this.entries.slice(0, this.cursor), redoable: this.entries.slice(this.cursor) };
  }
}
