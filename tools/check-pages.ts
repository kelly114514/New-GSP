import { readFileSync } from 'node:fs';
import { decodeGsp } from '../src/gsp/codec';
const d = decodeGsp(new Uint8Array(readFileSync(process.argv[2]))).doc;
console.log(d.pages.map(p => `${p.name}:${p.objects.length}`).join(' | '));
process.exitCode = JSON.stringify(d.pages.map(p => p.name)) === JSON.stringify(['首页', '第二页ABC']) ? 0 : 1;
