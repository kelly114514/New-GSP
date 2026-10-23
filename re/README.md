# 定向逆向环境

只用于查清 .gsp 格式和几何语义，结论写成规格，不产出产品代码。

| 路径 | 内容 |
|---|---|
| `unpacked/` | UPX 解包后的 `GSP5chs.exe`、`GSP5.exe`（控件版）、`GSP2EXE.exe`，分析时打开这里的文件 |
| `native-evidence/snapshot.json` | Ghidra 分析快照，含旧工程已命名的函数和注释；打开时用它恢复 |
| `native-evidence/evidence-bundle.json` | 去重后的原生证据 |
| `tools/` | Ghidra、JDK、UPX、CFR，本机工具，不入库；来源和校验值见 `toolchain.md` |
| `rea-*.mjs`、`rea-show.py` | REA 启动器、批量队列脚本、结果查看器 |

## 使用

**Claude Code：** 根目录 `.mcp.json` 注册了 `rea` 服务，在本目录开的新会话直接有 `mcp__rea__*` 工具。典型顺序：`open_binary`（`path` 为 `re/unpacked/GSP5chs.exe` 的绝对路径，`provider_id: "ghidra"`，`snapshot_path` 指向 `re/native-evidence/snapshot.json`）→ `procedure_pseudo_code` / `procedure_assembly` / `xrefs` 等 → `close_binary`。首个反编译请求要等 Ghidra 启动约 2 分钟，每个会话占数 GB 内存。

**脚本队列：**

```powershell
node re/rea-native-session.mjs --out re/sessions/<主题> --resume re/native-evidence/snapshot.json --skip-seeds
```

向 `<out>/queue.jsonl` 追加 `{"id":"名称","name":"REA工具","args":{...}}`，结果写到 `<id>.json`；追加 `{"id":"stop","stop":true}` 收尾。结果 JSON 很大，用 `python re/rea-show.py <结果.json>` 看。

Ghidra 曾把 `_free` 误标为 no-return 导致 CFG 截断，也会漏掉寄存器参数。结论要对照 Listing，不能机械照抄伪代码。

## 还需要查的

旧工程留下的入口（只是定位线索，不代表签名已确认）：

| 主题 | 地址 |
|---|---|
| 页面记录解释（读取主分派） | `004A9C80`；未查清的 callee：`00426310`、`00499B80`、`004A2130`、`004B6FE0` |
| 完整对象读取 | `004A9300` |
| 工具修复 | `004A99E0` |
| 文档读头/分派 | `00416A10 → 00416230 → 00436B50`，成员分支 `00416830/004AA560/00416140/004168F0` |
| 页序列化（写出） | `004A80F0` |
| 文档容器与兼容提示串 | `00436E00/0040EEC0/0040EAB0`；写错提示串会让原版崩溃，见 `../reference/format/compatibility-container/` |
| 父模板 | `0043B170` |
| 约束求值分派（已知 53 项） | `00440D70`；表项见 `../reference/format/recovery-object-dispatch.json` |

## 原件身份

| 文件 | SHA-256 |
|---|---|
| `original/sketchpad5/GSP5chs.exe` | `bf22c09822ad2da66f8e3655e5a9cbd6c8e494feaf78690cf118f9261887c7b3` |
| `re/unpacked/GSP5chs.exe` | `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a` |
| `re/unpacked/GSP5.exe` | `6c5ccf4bbefd9773931ece81c54cb5e657b9978ea148e6b7b8d9043fbba5560c` |
| `original/sketchpad5/Support Files/jsp5.jar` | `270e880a40309aee6c7704ca4aa4786d91032f18f176c50f58458988a88700da` |
