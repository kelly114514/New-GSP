/** 原版 GSP4 记录读取；未知记录保留原始字节及位置。 */
export interface RecordEntry { offset: number; tag: number; declaredLength: number; data: Uint8Array; raw: Uint8Array }
export interface RecordRead { records: RecordEntry[]; warnings: string[]; complete: boolean }

const knownTags = new Set([900,901,902,903,1000,1001,1002,1003,1006,1007,1100,1201,1203,1204,1300,2000,2002,2003,2005,2007,2008,2200,2201,2210,2211,2216,2300,2306,2307,2308,2309,2310,2311,2314,2316,2317,2318,2319,2399,2400,2401,2402,2403,2404,2405,2406,2407,2408,2409,2410,2411,2412,2413,2414,2415,2416,2417,2418,2419,8000,8002,8004,9000,9004,9005,9006,9007,9008,9009,10002,10003,10004,10005,10006,10007,10008,10020,10021,10022,10023,10040,10041,10042,10044]);

export function readRecords(bytes: Uint8Array): RecordRead {
  const records: RecordEntry[] = [], warnings: string[] = [];
  if (bytes.length < 4 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'GSP4') return { records, warnings: ['不是 GSP4 文件'], complete: false };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boundary = (at: number): boolean => at === bytes.length || (at >= 4 && at + 8 <= bytes.length && knownTags.has(view.getUint32(at + 4, true)) && view.getUint32(at, true) <= bytes.length - at - 8);
  let off = 4;
  while (off + 8 <= bytes.length) {
    const length = view.getUint32(off, true), tag = view.getUint32(off + 4, true);
    let actual = length;
    if (!boundary(off + 8 + actual)) {
      if (boundary(off + 9 + actual)) actual++;
      else return { records, warnings: [...warnings, `偏移 ${off} 的记录无法继续解析`], complete: false };
    }
    const end = off + 8 + actual;
    records.push({ offset: off, tag, declaredLength: length, data: bytes.slice(off + 8, end), raw: bytes.slice(off, end) });
    off = end;
  }
  if (off !== bytes.length) warnings.push(`末尾多出 ${bytes.length - off} 字节`);
  return { records, warnings, complete: off === bytes.length };
}
