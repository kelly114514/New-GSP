import { expect, it } from 'vitest';
import { App } from '../src/app';
import { Store } from '../src/core/store';
import { decodeFile, encodeFile, encodeNgsp } from '../src/gsp/codec';
import type { Id } from '../src/core/model';

it('数值和表格的字体操作可撤消，并在保存时保护格式', () => {
  const st = new Store(); let parameter: Id = 0, table: Id = 0;
  st.run('构造', () => {
    parameter = st.add({ k: 'param', name: 't', value: 2, unit: 'none', showEdit: true }, { at: { x: 10, y: 10 } }).id;
    table = st.add({ k: 'table', cols: [parameter], rows: [[2]] }, { at: { x: 10, y: 50 } }).id;
  });
  const view = { store: st, sel: [parameter, table], textEdit: undefined, invalidate() {} };
  const app = Object.create(App.prototype) as App;
  app.refreshTextbar = () => {};
  app.toggleFont(view as never, 'bold');
  expect(st.get(parameter)?.font?.bold).toBe(true);
  expect(st.get(table)?.font?.bold).toBe(true);
  app.fontSize(view as never, 2);
  expect(st.get(parameter)?.font?.size).toBe(20);
  expect(st.get(table)?.font?.size).toBe(16);
  expect(encodeFile(st.doc, undefined).ok).toBe(false);
  expect(decodeFile(encodeNgsp(st.doc), '字体.ngsp').doc).toEqual(st.doc);
  st.doUndo();
  expect(st.get(parameter)?.font?.size).toBe(18);
  st.doUndo();
  expect(st.get(parameter)?.font).toBeUndefined();
});
