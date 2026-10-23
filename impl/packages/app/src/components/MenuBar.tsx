import { MENU_LABELS } from '../menus';

/** 类似菜单栏的顶栏。现在只有静态标签，点击没有动作。 */
export function MenuBar() {
  return (
    <nav className="menubar" role="menubar" aria-label="主菜单">
      {MENU_LABELS.map((label) => (
        <button key={label} type="button" className="menubar__item" role="menuitem">
          {label}
        </button>
      ))}
    </nav>
  );
}
