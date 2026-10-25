import { buildPageDrawList } from '@gsp-plus/render';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CanvasView } from './components/CanvasView';
import { MenuBar } from './components/MenuBar';
import { ObjectPanel } from './components/ObjectPanel';
import { PageTabs } from './components/PageTabs';
import { StatusBar } from './components/StatusBar';
import { EditorController } from './model/editorController';
import { objectRows, pageTabTitle } from './model/objectRows';
import { isTextInputElement, shortcutAction } from './model/shortcuts';
import { windowTitleFor } from './model/title';
import type { MenuCommand } from './menus';
import { createFilePlatform } from './platform/filePlatform';
import { setWindowTitle } from './platform/windowTitle';

/** 等待用户在“放弃修改 / 取消”对话框里做选择。 */
interface DiscardRequest {
  fileName: string;
  resolve: (discard: boolean) => void;
}

export function App() {
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest | null>(null);
  const discardRef = useRef<DiscardRequest | null>(null);
  const [controller] = useState(
    () =>
      new EditorController(
        createFilePlatform(
          (fileName) =>
            new Promise<boolean>((resolve) => {
              const request = { fileName, resolve };
              discardRef.current = request;
              setDiscardRequest(request);
            }),
        ),
      ),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const { doc, pageIndex, selected, revision, dirty } = state;

  const page = doc?.model.pages[pageIndex];
  const evaluator = useMemo(
    () => (doc === null ? null : controller.evaluatorFor(pageIndex)),
    [controller, doc, pageIndex],
  );
  const scene = useMemo(
    () => (page === undefined || evaluator === null ? null : buildPageDrawList(page, evaluator.evaluate())),
    [page, evaluator, revision],
  );
  const rows = useMemo(
    () => (page === undefined || scene === null ? [] : objectRows(page, scene.drawnIndices, scene.evaluation)),
    [page, scene],
  );
  const titles = useMemo(
    () => (doc === null ? [] : doc.model.pages.map((p, i) => pageTabTitle(p, i))),
    [doc],
  );

  const answerDiscard = (discard: boolean) => {
    const request = discardRef.current;
    discardRef.current = null;
    setDiscardRequest(null);
    request?.resolve(discard);
  };

  const runCommand = useCallback(
    (command: MenuCommand) => {
      switch (command) {
        case 'open':
          void controller.openFile();
          break;
        case 'saveAs':
          void controller.saveAs();
          break;
        case 'undo':
          controller.undo();
          break;
        case 'redo':
          controller.redo();
          break;
      }
    },
    [controller],
  );

  // 快捷键：Ctrl+O 打开、Ctrl+Shift+S 另存为、Ctrl+Z 撤销、Ctrl+R 重做；Escape 取消进行中的拖动
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (discardRef.current !== null) return; // 确认框打开时不处理
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        controller.cancelDrag();
        return;
      }
      const action = shortcutAction(e, isTextInputElement(document.activeElement as HTMLElement | null));
      if (action === null) return;
      e.preventDefault(); // 也拦住 WebView 自带的 Ctrl+R 刷新，否则会丢掉当前文档
      if (e.repeat) return;
      runCommand(action);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, runCommand]);

  // 窗口标题
  useEffect(() => {
    const title = windowTitleFor(doc?.fileName ?? null, dirty);
    document.title = title;
    void setWindowTitle(title);
  }, [doc?.fileName, dirty]);

  const emptyText =
    doc === null
      ? '文件 → 打开…（Ctrl+O）打开一个 .gsp 文件'
      : page === undefined
        ? '这个文件里没有页'
        : '';

  const statusMessage =
    selected !== null && rows.some((r) => r.index === selected) && !state.dragActive && state.busy === null
      ? `已选中对象 #${selected}`
      : state.message;

  return (
    <div className="app">
      <MenuBar
        availability={{ hasDocument: doc !== null, canUndo: state.canUndo, canRedo: state.canRedo, busy: state.busy !== null }}
        onCommand={runCommand}
      />
      {state.error !== null && (
        <div className="banner" role="alert">
          <span className="banner__text">{state.error}</span>
          <button type="button" className="banner__close" aria-label="关闭提示" onClick={() => controller.dismissError()}>
            ×
          </button>
        </div>
      )}
      <div className="app__body">
        <section className="app__view">
          <PageTabs titles={titles} current={pageIndex} onSelect={(i) => controller.selectPage(i)} />
          <div className="app__canvas">
            <CanvasView
              scene={scene}
              selectedIndex={selected}
              onSelect={(i) => controller.select(i)}
              onFreePointDragStart={(i) => controller.beginDrag(i)}
              onFreePointDragMove={(i, x, y) => controller.moveDrag(i, x, y)}
              onFreePointDragEnd={() => controller.endDrag()}
              onFreePointDragCancel={() => controller.cancelDrag()}
              emptyText={emptyText}
            />
          </div>
        </section>
        <ObjectPanel
          rows={rows}
          selected={selected}
          onSelect={(i) => controller.select(i)}
          emptyText={doc === null ? '尚未打开文件。' : '这一页没有对象。'}
        />
      </div>
      <StatusBar
        fileName={doc?.fileName ?? null}
        layout={doc?.model.layout ?? null}
        pageCount={doc?.model.pages.length ?? 0}
        toolCount={doc?.model.tools.length ?? 0}
        objectCount={rows.length}
        drawnCount={scene?.drawnIndices.size ?? 0}
        unsupportedCount={scene?.unsupportedIndices.length ?? 0}
        dirty={dirty}
        message={statusMessage}
      />
      {discardRequest !== null && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="discard-title">
            <h2 className="modal__title" id="discard-title">
              有未保存的修改
            </h2>
            <p className="modal__text">“{discardRequest.fileName}”有尚未保存的修改。打开另一个文件会丢弃这些修改。</p>
            <div className="modal__actions">
              <button type="button" className="modal__button modal__button--danger" onClick={() => answerDiscard(true)}>
                放弃修改
              </button>
              <button type="button" className="modal__button" autoFocus onClick={() => answerDiscard(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
