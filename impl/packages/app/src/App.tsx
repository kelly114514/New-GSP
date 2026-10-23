import { useState } from 'react';
import { CanvasView } from './components/CanvasView';
import { MenuBar } from './components/MenuBar';
import { StatusBar } from './components/StatusBar';

export function App() {
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  return (
    <div className="app">
      <MenuBar />
      <main className="app__main">
        <CanvasView onResize={setCanvasSize} />
      </main>
      <StatusBar canvasSize={canvasSize} />
    </div>
  );
}
