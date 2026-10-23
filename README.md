# GSP-plus

以几何画板 5（中文版）为参照，重新开发一个 Windows 10 及以上的桌面动态几何软件（TypeScript + Canvas + Tauri 2）。目标是兼容原版的功能和 .gsp 文件，而不是逐函数复刻原程序；实现可以自由改进和加新功能。范围、顺序和验收见 [PLAN.md](PLAN.md)。

## 工作方式

- **规格方**：可以阅读 `reference/`、使用 `re/` 做定向逆向、操作原版，产出格式规格、功能规格和验收用例（输入文件 + 操作 + 期望结果）。不写产品代码。
- **实现方**：只依据规格和验收用例开发，不阅读反编译代码、`reference/format/recovery-notes/`、`reference/java/decompiled/` 或旧工程的恢复源码，也不从中复制代码。
- **验收**：以原版行为为准，比较打开、构造、拖动、保存、重开后的结果，不比较内存布局或字节级实现。

存档格式只有 .gsp，第一目标是原版 4.x/5.x 存的文件都能正确打开。

多 agent 协作时由 Opus 规划和检查、Sonnet/Haiku 作为 worker 执行；worker 出错记在 `worker-errors/`。

## 目录

| 路径 | 内容 | 谁用 |
|---|---|---|
| `original/sketchpad5/` | 原版发行包完整副本：主程序、控件版、桥接 DLL/OCX、GSP2EXE、6 本手册 PDF、`Samples/` 与 `Tool Folder/`（约 1,400 个 .gsp）、`Support Files/`（含 `jsp5.jar`、`Example Tools.gsp`） | 规格方；样本也作验收输入 |
| `samples/baseline/` | 原版 UI 生成并重开过的 5 个最小样本（空页、点、线段、中点、拖动后中点），附声明的对象图；`python samples/baseline/verify_baseline.py` 校验 | 验收 |
| `reference/format/` | .gsp 格式资料：`gsp-format.md`、`native-serialization.md`、样本结构统计、对象/约束分派表、原生架构说明；`recovery-notes/` 是旧工程逐模块的格式与行为笔记（含原地址）；`compatibility-container/` 是兼容提示串调查 | 规格方 |
| `reference/features/` | 手册提取的功能清单、菜单命令、资源字符串、PE 调查、手册全文（`manuals-text/`） | 规格方 |
| `reference/java/` | JavaSketchpad 组件的 Construction 语法与算法说明、反编译源码 | 规格方 |
| `re/` | 定向逆向环境（Ghidra/REA、解包后的程序、分析快照），见 `re/README.md` | 规格方 |
| `spec/` | 格式规格、对象目录、功能规格、验收用例；实现方唯一的输入 | 规格方写，实现方读 |
| `impl/` | 新程序代码（TypeScript 单仓） | 实现方 |
| `tools/` | `inspect_gsp.py`、`inspect_gsp_structure.py`：.gsp 记录级解析和统计；以及规格、对照、验收用的脚本 | 规格方、验收 |
| `oracle/` | 原版批量导出的对照输出，本机生成，不入库 | 规格方、验收 |
| `worker-errors/` | worker 出错记录，用于积累模型选择经验 | 规划者 |
| `archive/old-recovery.bundle` | 旧逆向工程（`逆向几何画板`）全部 git 历史的离线备份 | 需要追溯时 |

`reference/` 里的笔记写于旧工程，提到的 `analysis/...`、`recovered/native/src/...` 等路径只存在于旧工程历史中。

仓库公开，以下第三方版权内容只留在本机、不入库（见 `.gitignore`）：`original/`、`re/unpacked/`、`reference/java/decompiled/`、`reference/features/manuals-text/`、`reference/features/resource-text.json`、`reference/format/recovery-object-dispatch.json`、`reference/format/compatibility-container/*.json`。

## 旧工程

旧工程尝试逐函数完全复刻原版：主程序应用层约 5,000 个函数，恢复了 133 个，集中在文件读写底层，没有可运行程序。改走本路线后，其中的格式知识整理进了 `reference/`，恢复的 C++ 代码不再沿用。

完整历史在 GitHub `kelly114514/GSP-plus`（最后提交 `d0fe9985a7c1b1f285697ba2c0b5f3c20464b484`，2026-10-22），本地另有 `archive/old-recovery.bundle`。恢复方法：

```powershell
git clone archive/old-recovery.bundle old-recovery
```

## 下一步

见 [PLAN.md](PLAN.md) 第 9 节。
