import { buildPageDrawList } from '@gsp-plus/render';
import { PageGeometryEvaluator } from '@gsp-plus/core';
import type { DocumentModel } from '@gsp-plus/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { MenuBar } from './components/MenuBar';
import { ObjectPanel } from './components/ObjectPanel';
import { PageTabs } from './components/PageTabs';
import { StatusBar } from './components/StatusBar';
import { loadGspDocument } from './model/load';
import { objectRows, pageTabTitle } from './model/objectRows';
import { openGspFile } from './platform/openGsp';
import { setWindowTitle } from './platform/windowTitle';

interface OpenDocument {
  fileName: string;
  model: DocumentModel;
}

/** 路径的最后一段（Windows 反斜杠和正斜杠都认）。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function App() {
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('就绪');
  const busyRef = useRef(false);

  const [revision, setRevision] = useState(0);
  const page = doc?.model.pages[pageIndex];
  const evaluator = useMemo(() => page === undefined ? null : new PageGeometryEvaluator(page), [page]);
  const scene = useMemo(() => page === undefined || evaluator === null ? null : buildPageDrawList(page, evaluator.evaluate()), [page, evaluator, revision]);
  const moveFreePoint = (index: number, x: number, y: number) => {
    if (doc === null || evaluator === null) return;
    evaluator.moveFreePoint(doc.model.doc, index, x, y);
    setRevision((r) => r + 1);
    setMessage('已移动自由点');
  };
  const rows = useMemo(
    () => (page === undefined || scene === null ? [] : objectRows(page, scene.drawnIndices, scene.evaluation)),
    [page, scene],
  );
  const titles = useMemo(
    () => (doc === null ? [] : doc.model.pages.map((p, i) => pageTabTitle(p, i))),
    [doc],
  );

  const openFile = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const opened = await openGspFile();
      if (opened === null) return; // 用户取消
      const result = loadGspDocument(opened.bytes);
      if (!result.ok) {
        // 失败时保留之前打开的文档
        setError(result.message);
        setMessage('打开失败');
        return;
      }
      const fileName = baseName(opened.path);
      setDoc({ fileName, model: result.model });
      setPageIndex(0);
      setSelected(null);
      setError(null);
      setMessage(`已打开 ${fileName}`);
    } catch (e) {
      setError(`打开失败：${e instanceof Error ? e.message : String(e)}`);
      setMessage('打开失败');
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Ctrl+O
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openFile]);

  // 窗口标题
  useEffect(() => {
    const title = doc === null ? 'GSP-plus' : `GSP-plus - ${doc.fileName}`;
    document.title = title;
    void setWindowTitle(title);
  }, [doc]);

  const selectPage = (index: number) => {
    setPageIndex(index);
    setSelected(null);
  };

  const emptyText =
    doc === null
      ? '文件 → 打开…（Ctrl+O）打开一个 .gsp 文件'
      : page === undefined
        ? '这个文件里没有页'
        : '';

  const statusMessage =
    selected !== null && rows.some((r) => r.index === selected)
      ? `已选中对象 #${selected}`
      : message;

  return (
    <div className="app">
      <MenuBar onOpenFile={() => void openFile()} />
      {error !== null && (
        <div className="banner" role="alert">
          <span className="banner__text">{error}</span>
          <button type="button" className="banner__close" aria-label="关闭提示" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      <div className="app__body">
        <section className="app__view">
          <PageTabs titles={titles} current={pageIndex} onSelect={selectPage} />
          <div className="app__canvas">
            <CanvasView
              scene={scene}
              selectedIndex={selected}
              onSelect={setSelected}
              onMoveFreePoint={moveFreePoint}
              emptyText={emptyText}
            />
          </div>
        </section>
        <ObjectPanel
          rows={rows}
          selected={selected}
          onSelect={setSelected}
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
        message={statusMessage}
      />
    </div>
  );
}


