/**
 * 编辑原语。目的之一是证明写出器不依赖缓存字节：改一个字段，只需要替换那条记录的载荷。
 */

import { writeF64 } from './bytes.ts';
import { objectNodesOf, pagesOf } from './tree.ts';
import type { ContainerNode, GspDocument } from './tree.ts';
import { FREE_POINT_BYTES } from './views/object.ts';

/**
 * 改自由点坐标：只重写那个对象的 2201 载荷（16 字节：x、y 两个小端 double），其余字节原样不动。
 *
 * @param page 页容器，或页的下标（从 0 起，按文件次序）
 * @param objectIndex 页内对象序号，从 1 起（与 2002 里的父序号一致）
 * @throws RangeError 页或对象不存在、坐标不是有限数，或该对象没有 16 字节的 2201（不是自由点）
 */
export function setFreePointCoordinates(
  doc: GspDocument,
  page: ContainerNode | number,
  objectIndex: number,
  x: number,
  y: number,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`free point coordinates must be finite numbers, got (${x}, ${y})`);
  }
  let container: ContainerNode | undefined;
  if (typeof page === 'number') {
    container = pagesOf(doc)[page];
    if (container === undefined) throw new RangeError(`page ${page} does not exist`);
  } else {
    container = page;
  }
  const node = objectNodesOf(container)[objectIndex - 1];
  if (!Number.isInteger(objectIndex) || objectIndex < 1 || node === undefined) {
    throw new RangeError(`object ${objectIndex} does not exist in this page`);
  }
  const record = node.records.find((r) => r.kind === 2201);
  if (record === undefined || record.payload.length !== FREE_POINT_BYTES) {
    throw new RangeError(`object ${objectIndex} is not a free point (no 16-byte kind 2201 record)`);
  }
  // 换成新的载荷数组，不原地写：载荷可能是输入缓冲区的视图。
  const payload = new Uint8Array(record.payload);
  writeF64(payload, 0, x);
  writeF64(payload, 8, y);
  record.payload = payload;
}
