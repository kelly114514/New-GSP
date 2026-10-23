# impl：GSP-plus 实现

TypeScript 单仓（npm workspaces），桌面外壳是 Tauri 2，只面向 Windows 10 及以上。洁净室规则见 [CLAUDE.md](CLAUDE.md)，范围和里程碑见仓库根目录的 [PLAN.md](../PLAN.md)。

当前进度：**M0 工程骨架**。还没有任何 .gsp 格式代码，`core` 里只有占位。

## 目录

```text
impl/
  package.json            工作区根：npm workspaces，根脚本
  tsconfig.base.json      共用的严格 TS 配置
  packages/
    core/                 纯 TS 库，不依赖 DOM（lib 只有 ES2023），Node 里能跑全部测试
      src/                库代码；目前是 CORE_VERSION 和 readMagic()
      test/               vitest 测试；test/support/ 是可复用的语料测试工具
    render/               Canvas 2D 绘制（可用 DOM 类型），依赖 core；目前只有 drawGrid()
    app/                  React + Vite 前端：顶部菜单栏、画布、状态栏，界面文字为中文
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
- **插件与权限**（`src-tauri/capabilities/default.json`，只对 `main` 窗口）：`core:default`、`dialog:allow-open`（只开“打开文件”，没有保存、消息框）、`fs:allow-read-file`（只开读文件，没有静态路径范围）。dialog 选中的文件会被临时加入 fs 读取范围，所以前端只能读用户在对话框里选过的文件。以后需要写文件（保存）、保存对话框、文件关联启动时读文件，再按需加权限，不要直接上 `fs:default`。
- **CSP**：`default-src 'self'`，另允许 Tauri IPC（`ipc:` 和 `http://ipc.localhost`）。在 Tauri 窗口里加载外部脚本或连外网都会被拦。
- 前端 `packages/app/src/platform/openGsp.ts` 里的 `openGspFile()` 把 dialog + fs 串起来（选 .gsp、读字节），目前还没有菜单项调用它。
- Rust 工具链用本机的 nightly（msvc）；`Cargo.lock` 入库，`target/` 和 `src-tauri/gen/` 不入库。构建 Tauri 需要 Visual Studio 2022 生成工具；第一次打 NSIS 包会从 GitHub 下载 NSIS，还会从 go.microsoft.com 下载 WebView2 引导程序（之后有缓存）。

## CI

仓库根的 `.github/workflows/ci.yml`：push 和 PR 时在 `windows-latest`、Node 24 上，于 `impl/` 里依次执行 `npm ci`、`npm run typecheck`、`npm test`。不构建 Tauri。
