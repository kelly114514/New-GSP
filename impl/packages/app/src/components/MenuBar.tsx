import { useEffect, useRef, useState } from 'react';
import { MENU_LABELS, menuItems } from '../menus';
import type { MenuAvailability, MenuCommand, MenuLabel } from '../menus';

export interface MenuBarProps {
  availability: MenuAvailability;
  /** 点击可用的菜单项。 */
  onCommand: (command: MenuCommand) => void;
}

/**
 * 顶部菜单栏。“文件”（打开…、另存为…）和“编辑”（撤销、重做）有下拉内容，
 * 无可用动作的项显示为禁用；其它菜单名暂时只是标签。
 */
export function MenuBar({ availability, onCommand }: MenuBarProps) {
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
        const items = menuItems(label, availability);
        const hasMenu = items.length > 0;
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
                {items.map((item) => (
                  <button
                    key={item.command}
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    disabled={!item.enabled}
                    aria-disabled={!item.enabled}
                    onClick={() => {
                      setOpenMenu(null);
                      onCommand(item.command);
                    }}
                  >
                    <span>{item.label}</span>
                    <kbd>{item.shortcut}</kbd>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
