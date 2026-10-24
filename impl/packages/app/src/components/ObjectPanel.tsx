import { useEffect, useRef } from 'react';
import { formatCoordinate } from '../model/objectRows';
import type { ObjectRow } from '../model/objectRows';

export interface ObjectPanelProps {
  /** 当前页的对象行。 */
  rows: ObjectRow[];
  /** 选中的对象序号（页内，从 1 起）。 */
  selected: number | null;
  onSelect: (index: number) => void;
  /** 没有对象时显示的提示。 */
  emptyText: string;
}

/** 右侧对象列表：当前页每个对象一行，选中行会在画布上高亮。 */
export function ObjectPanel({ rows, selected, onSelect, emptyText }: ObjectPanelProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // 选中项来自画布点击时，把它滚到可见区域
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <aside className="objects" aria-label="对象列表">
      <header className="objects__head">对象列表（{rows.length} 个）</header>
      {rows.length === 0 ? (
        <p className="objects__empty">{emptyText}</p>
      ) : (
        <ul className="objects__list" role="listbox" aria-label="当前页对象" ref={listRef}>
          {rows.map((row) => {
            const isSelected = row.index === selected;
            const meta = [
              `主类 ${row.mainKind}`,
              `genera ${row.genera}`,
              `父 ${row.parents.length > 0 ? row.parents.join(', ') : '无'}`,
            ];
            if (row.point !== undefined) {
              meta.push(`坐标 (${formatCoordinate(row.point.x)}, ${formatCoordinate(row.point.y)})`);
            }
            if (row.label !== undefined) meta.push(`标签「${row.label}」`);
            return (
              <li
                key={row.index}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                className={isSelected ? 'objects__row objects__row--selected' : 'objects__row'}
                onClick={() => onSelect(row.index)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row.index);
                  }
                }}
              >
                <div className="objects__title">
                  <span className="objects__index">#{row.index}</span>
                  <span className="objects__constraint">约束 {row.constraintId}</span>
                  <span className={row.drawn ? 'tag tag--ok' : 'tag'}>{row.drawn ? '已绘制' : '暂不支持'}</span>
                </div>
                <div className="objects__desc">{row.description}</div>
                <div className="objects__meta">{meta.join(' · ')}</div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
