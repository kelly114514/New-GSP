# 实现方规则（洁净室）

`impl/` 是新程序代码。在这里工作的人或 agent 是**实现方**。

## 只能读

- `spec/`（格式规格、对象目录、功能规格、验收用例）
- `impl/`
- `samples/baseline/`
- 仓库根目录的 `PLAN.md`、`README.md`
- `original/**/*.gsp`：只能作为测试输入让代码读取字节，不要打开 `original/` 下的其它文件

## 禁止读

`reference/`、`re/`、`archive/`、`oracle/`、`tools/` 下的脚本源码，以及 `original/` 下除 .gsp 以外的任何文件。也不要用 REA/Ghidra 等逆向工具。

规格不够用时，把问题写进 `spec/questions.md`（问题、你需要什么、卡住了哪个功能），然后先做别的，不要自己去翻禁读目录。

## 技术约定

- TypeScript strict，npm workspaces，单仓根目录是 `impl/`。
- `packages/core` 不依赖 DOM 和界面，必须能在 Node 里跑。
- 只面向 Windows 10 及以上（Tauri 2 + WebView2）。
- .gsp 是唯一的存档格式。读入时不认识的记录原样保留，写出时原样放回。
- 语料测试从环境变量 `GSP_CORPUS_DIR` 读目录，默认 `../original/sketchpad5`；目录不存在时跳过，不算失败。
