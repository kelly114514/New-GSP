import { buildPageDrawList } from '@gsp-plus/render';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CanvasView } from './components/CanvasView';
import { MenuBar } from './components/MenuBar';
import { ObjectPanel } from './components/ObjectPanel';
import { PageTabs } from './components/PageTabs';
import { StatusBar } from './components/StatusBar';
import { EditorController, editorTitle } from './model/editor';
import { objectRows, pageTabTitle } from './model/objectRows';
import { editorCommand } from './model/shortcuts';
import { openGspFile } from './platform/openGsp';
import { chooseGspSavePath, writeGspFile } from './platform/saveGsp';
import { setWindowTitle } from './platform/windowTitle';

export function App() {
  const [editor] = useState(() => new EditorController({ open: openGspFile, chooseSavePath: chooseGspSavePath, write: writeGspFile }));
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const { document: doc, pageIndex, selected, error, message, revision } = state;
  const page = doc?.model.pages[pageIndex];
  const evaluator = editor.getEvaluator();
  const scene = useMemo(() => page === undefined || evaluator === null ? null : buildPageDrawList(page, evaluator.evaluate()), [page, evaluator, revision]);
  const rows = useMemo(
    () => (page === undefined || scene === null ? [] : objectRows(page, scene.drawnIndices, scene.evaluation)),
    [page, scene],
  );
  const titles = useMemo(
    () => (doc === null ? [] : doc.model.pages.map((p, i) => pageTabTitle(p, i))),
    [doc],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = editorCommand(event);
      if (command === null) return;
      if (editor.getSnapshot().pendingReplacement) {
        if (command === 'cancel') {
          event.preventDefault();
          editor.resolveReplacement(false);
        }
        return;
      }
      if (command === 'cancel') {
        if (editor.cancelDrag()) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (command === 'open') void editor.openFile();
      else if (command === 'saveAs') void editor.saveAs();
      else if (command === 'undo') editor.undo();
      else editor.redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor]);

  const title = editorTitle(state);
  useEffect(() => {
    document.title = title;
    void setWindowTitle(title);
  }, [title]);

  const emptyText = doc === null
    ? '文件 → 打开…（Ctrl+O）打开一个 .gsp 文件'
    : page === undefined ? '这个文件里没有页' : '';
  const statusMessage = selected !== null && rows.some((r) => r.index === selected)
    ? `已选中对象 #${selected}` : message;

  return (
    <div className="app">
      <MenuBar
        onOpenFile={() => void editor.openFile()}
        onSaveAs={() => void editor.saveAs()}
        onUndo={editor.undo}
        onRedo={editor.redo}
        canOpen={state.busy === null}
        canSave={doc !== null && state.busy === null}
        canUndo={state.canUndo && !state.pendingReplacement}
        canRedo={state.canRedo && !state.pendingReplacement}
      />
      {error !== null && (
        <div className="banner" role="alert">
          <span className="banner__text">{error}</span>
          <button type="button" className="banner__close" aria-label="关闭提示" onClick={editor.clearError}>×</button>
        </div>
      )}
      <div className="app__body">
        <section className="app__view">
          <PageTabs titles={titles} current={pageIndex} onSelect={editor.selectPage} />
          <div className="app__canvas">
            <CanvasView
              scene={scene}
              selectedIndex={selected}
              onSelect={editor.selectObject}
              onBeginFreePointDrag={editor.beginDrag}
              onMoveFreePoint={editor.previewDrag}
              onCommitFreePointDrag={editor.commitDrag}
              onCancelFreePointDrag={editor.cancelDrag}
              dragEpoch={state.dragEpoch}
              interactionDisabled={state.pendingReplacement}
              emptyText={emptyText}
            />
          </div>
        </section>
        <ObjectPanel rows={rows} selected={selected} onSelect={editor.selectObject}
          emptyText={doc === null ? '尚未打开文件。' : '这一页没有对象。'} />
      </div>
      <StatusBar
        fileName={doc?.fileName ?? null}
        dirty={state.dirty}
        busy={state.busy}
        layout={doc?.model.layout ?? null}
        pageCount={doc?.model.pages.length ?? 0}
        toolCount={doc?.model.tools.length ?? 0}
        objectCount={rows.length}
        drawnCount={scene?.drawnIndices.size ?? 0}
        unsupportedCount={scene?.unsupportedIndices.length ?? 0}
        message={statusMessage}
      />
      {state.pendingReplacement && (
        <div className="dialog-backdrop">
          <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description"
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const buttons = event.currentTarget.querySelectorAll('button');
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
            }}>
            <h2 id="discard-title">放弃未保存修改？</h2>
            <p id="discard-description">当前文档有未保存修改。放弃后将打开刚选择的文件。</p>
            <div className="confirm-dialog__actions">
              <button type="button" onClick={() => editor.resolveReplacement(true)}>放弃修改并打开</button>
              <button type="button" autoFocus onClick={() => editor.resolveReplacement(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
