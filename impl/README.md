# impl：GSP-plus 实现

TypeScript 单仓（npm workspaces），桌面外壳是 Tauri 2，只面向 Windows 10 及以上。洁净室规则见 [CLAUDE.md](CLAUDE.md)，范围和里程碑见仓库根目录的 [PLAN.md](../PLAN.md)。

当前进度：**M1 core：.gsp 无损读写**已完成（见下文“core：.gsp 无损读写”）；查看器已接入 **M3 第一批编辑闭环：打开 → 拖动自由点 → 撤销/重做 → 另存为 → 重开**。本批不包含新建构造、删除、文本/属性编辑或新增页面，产品契约见 `spec/features/m3-editor-closure.md`。

## 目录

```text
impl/
  package.json            工作区根：npm workspaces，根脚本
  tsconfig.base.json      共用的严格 TS 配置
  packages/
    core/                 纯 TS 库，不依赖 DOM（lib 只有 ES2023），Node 里能跑全部测试
      src/                库代码：.gsp 记录层、无损树、读写器、视图、对象模型；scripts/ 是生成表脚本和 gsp-dump CLI
      test/               vitest 测试；test/support/ 是可复用的语料测试工具
    render/               Canvas 2D 绘制（可用 DOM 类型），依赖 core；纯描述（页 → 绘制列表）、视图变换、命中测试、画布绘制
    app/                  React + Vite 前端：菜单栏、页签、画布、对象列表、状态栏，界面文字为中文
    desktop/              Tauri 2 外壳
      app-icon.png        图标源图（1024×1024），`npx tauri icon` 由它生成 src-tauri/icons/
      src-tauri/          Rust 侧：Cargo.toml、tauri.conf.json、capabilities/、icons/
```

依赖方向：`app → render → core`；`desktop` 只负责加载 `app` 的构建结果，不依赖其它包的代码。

各包在 package.json 里直接导出 `src/index.ts`（不预先编译），Vite、vitest、tsc 都按源码解析，改了 core 立刻对其它包生效。

## 常用命令

在 `impl/` 下执行：

| 命令 | 作用 |
|---|---|
| `npm install`（或 CI 里用 `npm ci`） | 安装全部依赖 |
| `npm run typecheck` | 各包 `tsc`（core 分“源码”和“源码+测试”两遍；core 的源码那一遍不带 DOM 和 Node 类型，用来保证它保持纯净） |
| `npm test` | 各包 `vitest run` |
| `npm run dev` | Tauri 开发模式：自动起 Vite 开发服务器（`http://127.0.0.1:5173`）并打开桌面窗口 |
| `npm run build` | Tauri 发布构建，生成 NSIS 安装包 |
| `npm run dev:web` / `npm run build:web` | 只跑前端（浏览器里看界面；Tauri 插件相关功能在浏览器里不可用） |

调试版安装包：`npm run build:debug -w @gsp-plus/desktop`，产物在
`packages/desktop/src-tauri/target/debug/bundle/nsis/GSP-plus_<版本>_x64-setup.exe`（发布版在 `target/release/bundle/nsis/`）。

在单个包里测试：`npm test -w @gsp-plus/core`，或进入该包目录直接 `npx vitest run`。

## core：.gsp 无损读写（M1）

`packages/core` 能把任意 .gsp 读成无损树再原样写回（语料 1,431 个文件逐字节一致）。规格见 `spec/format/gsp-format.md`。

```ts
import { parseGsp, writeGsp, readDocumentModel, setFreePointCoordinates, toDebugJson, validateDocument } from '@gsp-plus/core';

const doc = parseGsp(bytes);                 // 严格拒绝坏结构，抛 GspFormatError（code、offset、reason）
const model = readDocumentModel(doc);        // 页/工具区/对象/父序号/自由点/约束描述符
setFreePointCoordinates(doc, 0, 1, 251, 174); // 第 0 页第 1 个对象，只改那条 2201 的 16 字节
const out = writeGsp(doc);                   // 未修改的文档逐字节还原
```

| 层 | 文件 | 内容 |
|---|---|---|
| 记录层 | `records.ts` | `GspRecord {kind, payload, pad}`；`readRecordAt`、`splitRecords`；补齐字节原值保留 |
| 树 | `tree.ts`、`parser.ts`、`writer.ts` | `GspDocument → EnvelopeNode → ContainerNode(page/tool/group/blob) → ObjectNode`；不认识的 kind 留在原位置；901 之后的多余字节存在 `doc.trailing`；`parseGsp` / `writeGsp` |
| 视图 | `views/*.ts` | 只读解码：文档头 900、信封 902（三个提示串，补齐字节保留）、页头、1100/9004 串、1201/1203、对象头 2000（布局 5/4）、2002、2201、2005、2008、8004、1300。形状不对返回 `undefined`，不抛异常 |
| 文本 | `text.ts` | 布局 5 → UTF-8；布局 4 → GBK（可选 Big5）；坏字节得 U+FFFD，不抛异常；原始字节另存 |
| 模型 | `model.ts`、`constraints.ts` | 每个容器的对象列表（1 起序号、约束 ID、主类、genera、父序号、自由点、约束描述符） |
| 校验 | `validate.ts` | `validateDocument(doc)` 返回不变量违例清单（页数/对象数/父序号/自由点/信封对应……），读入时不调用 |
| 调试 | `debug.ts`、`scripts/gsp-dump.ts` | `toDebugJson(doc)`；CLI 见下 |

读取器只在结构层面拒绝：魔数、截断、长度越界、首尾记录、嵌套不配对或位置不允许、902 提示串结构（`fixtures/crash-19byte-envelope.gsp` 会被拒绝）、2000 头短于 12 字节。

### 生成表

`src/generated/constraints.ts`（约束 ID → 约束表 main_kind/genera/父模板词/描述模板）和 `recordKinds.ts`（kind → 名称/配对）由 `spec/objects/catalog.json`、`spec/format/record-kinds.json` 生成并提交。规格改了以后在 `impl/` 下运行：

```
npm run gen
```

有测试检查已提交的文件与规格同步。

### 命令行

```
node packages/core/scripts/gsp-dump.ts <file.gsp> [--summary] [--hex-limit N] [--big5] [--compact]
```

不需要构建：Node 24 直接剥掉类型运行 `.ts`。

### 导入约定（Node / vitest / Vite / tsc 通用）

- core 的 `src/` 和 `scripts/` 里的相对导入**一律带 `.ts` 扩展名**（`import { x } from './records.ts'`），因为 Node 的 ESM 解析要求写全；`tsconfig.base.json` 打开了 `allowImportingTsExtensions`（项目 `noEmit`），Vite、vitest 本来就认。
- 只用可擦除的 TS 语法（没有 enum、namespace、参数属性；`packages/core/tsconfig.json` 开了 `erasableSyntaxOnly`），类型导入用 `import type`（`verbatimModuleSyntax` 强制）。
- core 不带 DOM 库，`text.ts` 通过 `globalThis` 取 `TextDecoder`/`TextEncoder`，用局部结构类型而不是全局声明，避免与 DOM 库或 `@types/node` 的声明冲突；Node 24（完整 ICU）和 WebView2 都有 gbk/big5。
- 测试文件（`test/`）沿用无扩展名导入（由 vitest 解析）。

## 查看器与自由点编辑闭环（M3 第一批）

`npm run dev` 或安装包里：**文件 → 打开…**（Ctrl+O）选一个 .gsp。读取失败时顶部显示中文错误（含原因和字节偏移），保留之前打开的文档。

- 页签：每页一个；页名为空时显示“第 N 页”。工具区不作为页，只在状态栏计数。
- 对象列表（右侧）：当前页每个对象一行，显示序号、约束 ID、描述（描述模板的 `^A` 等标记换成 `〈A〉`）、主类、genera、父序号、标签和自由点坐标。点列表行或画布上的对象会高亮。
- 画布：由现有几何求值结果绘制已支持对象；自由点拖动后重算依赖对象（包括基准样本的中点）。不支持的对象继续保留存档内容并计入“暂不支持”。
- 操作：拖动空白处平移，滚轮以光标为中心缩放，“适合窗口”按钮或打开文件时自动适合窗口（最多放大 2 倍）。
- 自由点编辑：布局 5 文件中拖动自由点即时预览；松开提交一步，移回起点不提交。Escape、pointercancel 或丢失指针捕获恢复拖动起点；派生点没有新增拖动入口。
- 编辑 → 撤销（Ctrl+Z）/重做（Ctrl+R）：一份文档共享跨页历史，执行后定位到操作所在页；撤销后新编辑清空重做分支。输入控件保留原生编辑快捷键。
- 文件 → 另存为…（Ctrl+Shift+S）：原生对话框只列 `.gsp`，调用现有 `writeGsp` 写入确定快照。取消或失败保留路径与检查点；保存期间后续编辑仍显示未保存。打开与保存互斥，重复操作不会覆盖状态。
- 修改状态：按当前写出字节与最近成功打开/保存的字节检查点比较；标题文件名后显示 `*`，状态栏显示“未保存修改”。原打开路径和最近保存路径分别保留。
- 打开另一文件：取消/读取失败/解析失败保留原文档与历史；替换未保存文档前提供“放弃修改并打开”与“取消”。本批尚未增加窗口关闭前的未保存提示。
- 状态栏：文件名、修改与文件操作状态、布局版本（4/5）、页数、工具区数、当前页对象数、已绘制 / 暂不支持数。

文档控制器在 `packages/app/src/model/editor.ts`；事务与保存测试覆盖基准样本 `midpoint.gsp` 的 `(211,147) → (251,174)`、派生中点、跨页历史、字节检查点、异步保存、重开、未知记录和未修改页保留。普通浏览器预览中的原生文件操作显示可恢复中文错误。

绘制描述和视图的纯函数在 `packages/render`（`buildPageDrawList`、`fitView`、`zoomAt`、`hitTest`、`drawPageScene`），单测用基准样本 `samples/baseline/samples/*.gsp`。

## 语料测试怎么找到语料

`packages/core/test/support/`（通过 `./support` 引入）提供：

- `corpusDir()`：语料目录。读环境变量 `GSP_CORPUS_DIR`；没设（或为空）就用 `<仓库根>/original/sketchpad5`。`GSP_CORPUS_DIR` 如果是相对路径，按 `impl/` 解析。
- `corpusAvailable(dir?)`：目录是否存在。
- `corpusFiles(dir?)`：递归列出目录下所有 `.gsp`（扩展名不分大小写），返回排好序的绝对路径；目录不存在返回空数组。
- `baselineSampleFiles()`：`<仓库根>/samples/baseline/samples/*.gsp`，已入库，始终存在。
- `readBytes(file)`、`displayPath(file)`、`repoRoot`、`implRoot` 等小工具。

写语料测试的套路（参考 `test/corpus.test.ts`）：

```ts
import { corpusAvailable, corpusDir, corpusFiles } from './support';

// 语料目录不存在时整组跳过，不算失败
describe.skipIf(!corpusAvailable())('语料库', () => {
  it('…', () => {
    for (const file of corpusFiles()) { /* … */ }
  });
});
```

本机有 `original/` 时跑全语料；GitHub CI 上没有 `original/`，语料测试显示为 skipped，`samples/baseline/` 的测试照常运行。换语料目录：

```powershell
$env:GSP_CORPUS_DIR = 'D:\somewhere\gsp-files'; npm test
```

## 桌面外壳（Tauri 2）说明

- 窗口标题 `GSP-plus`，应用标识 `com.gspplus.desktop`（没有用 `.app` 结尾：Tauri 会对此告警，它与 macOS 的包扩展名冲突；我们只发 Windows）。
- **安装包**：只出 NSIS（`bundle.targets = ["nsis"]`），默认按当前用户安装（`installMode = currentUser`，不需要管理员权限），安装语言简体中文和英文（按系统语言选）。
- **WebView2**：`embedBootstrapper`。把约 1.8 MB 的微软 WebView2 引导程序直接打进安装包，目标机器没有运行时（部分 Windows 10）时由它联网安装；相比默认的 `downloadBootstrapper` 少一次“安装时先去下载引导程序”，更不容易被网络环境卡住，代价是安装包大 1.8 MB。Windows 11 自带运行时，不会触发。要完全离线可改成 `offlineInstaller`（安装包增加约 127 MB）。
- **C 运行库**：`src-tauri/.cargo/config.toml` 让 MSVC 目标静态链接 CRT，干净的 Windows 10 不需要先装 VC++ 运行库。
- **插件与权限**（`src-tauri/capabilities/default.json`，只对 `main` 窗口）：`core:default`、`dialog:allow-open`、`dialog:allow-save`、`fs:allow-read-file`、`fs:allow-write-file`，没有静态路径范围。dialog 选中的文件会被临时加入 fs 范围，仅支持读写用户选定的文件；没有开放 `fs:default`、全盘路径范围或消息框权限。
- **CSP**：`default-src 'self'`，另允许 Tauri IPC（`ipc:` 和 `http://ipc.localhost`）。在 Tauri 窗口里加载外部脚本或连外网都会被拦。
- 前端 `packages/app/src/platform/openGsp.ts` 里的 `openGspFile()` 把 dialog + fs 串起来（选 .gsp、读字节），由“文件 → 打开…”和 Ctrl+O 调用。
- `packages/app/src/platform/saveGsp.ts` 选择 `.gsp` 保存路径并写入快照字节，由“文件 → 另存为…”和 Ctrl+Shift+S 调用。
- `capabilities/default.json` 另有 `core:window:allow-set-title`，只为把窗口标题设成 `GSP-plus - <文件名>`，有未保存修改时追加 ` *`。
- Rust 工具链用本机的 nightly（msvc）；`Cargo.lock` 入库，`target/` 和 `src-tauri/gen/` 不入库。构建 Tauri 需要 Visual Studio 2022 生成工具；第一次打 NSIS 包会从 GitHub 下载 NSIS，还会从 go.microsoft.com 下载 WebView2 引导程序（之后有缓存）。

## CI

仓库根的 `.github/workflows/ci.yml`：push 和 PR 时在 `windows-latest`、Node 24 上，于 `impl/` 里依次执行 `npm ci`、`npm run typecheck`、`npm test`。不构建 Tauri。
