import { useEffect, useRef, useState } from 'react';
import { MENU_LABELS } from '../menus';
import type { MenuLabel } from '../menus';

export interface MenuBarProps {
  /** 文件 → 打开… 。 */
  onOpenFile: () => void;
}

/**
 * 顶部菜单栏。只有“文件”有下拉内容（打开…）；其它菜单名暂时只是标签。
 */
export function MenuBar({ onOpenFile }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuLabel | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (openMenu === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  return (
    <nav className="menubar" role="menubar" aria-label="主菜单" ref={navRef}>
      {MENU_LABELS.map((label) => {
        const isFile = label === '文件';
        const open = openMenu === label;
        return (
          <div key={label} className="menubar__group">
            <button
              type="button"
              className="menubar__item"
              role="menuitem"
              aria-haspopup={isFile ? 'menu' : undefined}
              aria-expanded={isFile ? open : undefined}
              onClick={() => {
                if (isFile) setOpenMenu(open ? null : label);
              }}
            >
              {label}
            </button>
            {isFile && open && (
              <div className="menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenFile();
                  }}
                >
                  <span>打开…</span>
                  <kbd>Ctrl+O</kbd>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
