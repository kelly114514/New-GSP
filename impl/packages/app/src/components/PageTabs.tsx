export interface PageTabsProps {
  /** 每个页签的文字（页名或“第 N 页”）。 */
  titles: string[];
  current: number;
  onSelect: (pageIndex: number) => void;
}

/** 页签条：每页一个标签，点击切换当前页。 */
export function PageTabs({ titles, current, onSelect }: PageTabsProps) {
  if (titles.length === 0) return null;
  return (
    <div className="pagetabs" role="tablist" aria-label="页">
      {titles.map((title, i) => {
        const selected = i === current;
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={selected}
            className={selected ? 'pagetabs__tab pagetabs__tab--current' : 'pagetabs__tab'}
            title={title}
            onClick={() => onSelect(i)}
          >
            {title}
          </button>
        );
      })}
    </div>
  );
}
