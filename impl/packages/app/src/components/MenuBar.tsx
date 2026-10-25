import { useEffect, useRef, useState } from 'react';
import { MENU_LABELS } from '../menus';
import type { MenuLabel } from '../menus';

export interface MenuBarProps {
  /** 文件 → 打开… 。 */
  onOpenFile: () => void;
  onSaveAs: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canOpen: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * 文件操作与文档历史；其它菜单名暂时只是标签。
 */
export function MenuBar({ onOpenFile, onSaveAs, onUndo, onRedo, canOpen, canSave, canUndo, canRedo }: MenuBarProps) {
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
        const hasMenu = label === '文件' || label === '编辑';
        const actions = label === '文件' ? [
          { name: '打开…', key: 'Ctrl+O', enabled: canOpen, run: onOpenFile },
          { name: '另存为…', key: 'Ctrl+Shift+S', enabled: canSave, run: onSaveAs },
        ] : [
          { name: '撤销', key: 'Ctrl+Z', enabled: canUndo, run: onUndo },
          { name: '重做', key: 'Ctrl+R', enabled: canRedo, run: onRedo },
        ];
        const open = openMenu === label;
        return (
          <div key={label} className="menubar__group">
            <button
              type="button"
              className="menubar__item"
              role="menuitem"
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-expanded={hasMenu ? open : undefined}
              onClick={() => {
                if (hasMenu) setOpenMenu(open ? null : label);
              }}
            >
              {label}
            </button>
            {hasMenu && open && (
              <div className="menu" role="menu">
                {actions.map((action) => <button
                  key={action.name}
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  disabled={!action.enabled}
                  onClick={() => {
                    setOpenMenu(null);
                    action.run();
                  }}
                >
                  <span>{action.name}</span>
                  <kbd>{action.key}</kbd>
                </button>)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
