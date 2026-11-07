import { describe, expect, it } from 'vitest';
import menuSpec from '../src/menu-spec.json';
import { commands } from '../src/commands';
import '../src/ui/menus';

interface Item { id?: number; name?: string; children?: Item[] }
const flat = (items: Item[]): Item[] => items.flatMap(i => [i, ...(i.children ? flat(i.children) : [])]);

describe('命令矩阵', () => {
  const all = (menuSpec as { items: Item[] }[]).flatMap(m => flat(m.items)).filter(i => i.id !== undefined && i.id > 0);
  it('规格里的每个命令都有“已实现”或“本版暂缓”的明确映射', () => {
    const missing = all.filter(i => !commands.has(i.id!)).map(i => `${i.id} ${i.name}`);
    expect(missing).toEqual([]);
  });
  it('暂缓项恰好是计划里列出的那些', () => {
    const deferred = [...commands].filter(([, d]) => d.deferred).map(([id, d]) => `${id}:${d.deferred}`).sort();
    expect(deferred).toEqual([]);
  });
});
