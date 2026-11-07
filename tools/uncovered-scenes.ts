import { readFileSync } from 'node:fs';
const spec = JSON.parse(readFileSync('../reference/spec/menus.json', 'utf8')) as { scenes: string[] };
const src = readFileSync('tests/scenes.test.ts', 'utf8');
const covered = spec.scenes.filter(s => src.includes(`'${s}':`));
console.log(`场景 ${spec.scenes.length}，已自动化 ${covered.length}`);
console.log('未自动化：', spec.scenes.filter(s => !covered.includes(s)).join('；'));
