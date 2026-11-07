/** 安装包验收：静默安装到临时目录 → 扫描发布内容 → 桌面冒烟 → 静默卸载并确认清除。
 * 用法：npx tsx tools/installer-check.ts <安装包.exe> <样本.gsp> */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [setup, sample] = [process.argv[2], process.argv[3]];
const dir = join(tmpdir(), `新版-安装测试-${process.pid}`);
const results: [string, boolean, string?][] = [];
const check = (n: string, ok: boolean, note?: string) => { results.push([n, ok, note]); console.log(ok ? '通过' : '失败', n, note ?? ''); };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
function* walk(d: string): Generator<string> { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }

mkdirSync(dir, { recursive: true });
const inst = spawnSync(setup, ['/S', `/D=${dir}`], { timeout: 120000 });
check('静默安装退出码 0', inst.status === 0, String(inst.status));
const exe = join(dir, 'new-gsp.exe');
for (let i = 0; i < 20 && !existsSync(exe); i++) await wait(500);
check('安装后有主程序', existsSync(exe));
check('安装后有卸载程序', existsSync(join(dir, 'uninstall.exe')));

// 发布内容扫描：不得出现原版程序、PDF、采集截图、原始资源、开发样例库
const files = [...walk(dir)].map(f => f.slice(dir.length + 1));
const forbidden = files.filter(f => /GSP5|sketchpad|\.pdf$|\.gsp$|\.npg$|fixtures|screenshot|shots|reference|\.upx|raw[\\/]/i.test(f));
check('发布目录不含原版程序/PDF/截图/原始资源/样例库', forbidden.length === 0, forbidden.join('，'));
console.log('安装内容：', files.join('、'), `（${files.reduce((s, f) => s + statSync(join(dir, f)).size, 0)} 字节）`);

const smoke = spawnSync('npx', ['tsx', 'tools/desktop-smoke.ts', exe, sample], { shell: true, stdio: 'inherit', timeout: 180000 });
check('安装后的程序通过桌面冒烟', smoke.status === 0, String(smoke.status));

const un = spawnSync(join(dir, 'uninstall.exe'), ['/S', `_?=${dir}`], { timeout: 120000 });
check('静默卸载退出码 0', un.status === 0, String(un.status));
await wait(1500);
rmSync(join(dir, 'uninstall.exe'), { force: true });
const left = existsSync(dir) ? [...walk(dir)].map(f => f.slice(dir.length + 1)) : [];
check('卸载后程序文件已清除', !left.some(f => /new-gsp\.exe$/i.test(f)), left.join('，'));
rmSync(dir, { recursive: true, force: true });
const failed = results.filter(r => !r[1]);
console.log(`安装包验收：${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
