# 交接：下一步做 M2（基础几何与拖动）

写于 2026-10-23。接手者先读 `README.md`、`PLAN.md`，再读本文件。本文件只管“现在到哪了、下一步怎么做”；做完一轮后改写本文件，不要追加流水账。

## 1. 现状

| 项 | 状态 |
|---|---|
| 仓库 | github.com/kelly114514/New-GSP，**公开**。工作分支 `s0-m1`，PR #1 已开，CI 2 项全过，等用户决定是否合并进 `main` |
| S0 | 对象目录 `spec/objects/catalog.json`；对照工具 `tools/oracle/`、`tools/emf_dump.py` |
| S1 | 格式规格 `spec/format/gsp-format.md` v1；语法检查 `tools/check_gsp_grammar.py`（全语料 0 违规） |
| M0 | `impl/` TypeScript 单仓 + Tauri 2，CI 跑类型检查和测试 |
| M1 | core 无损读写：1,431 个语料文件逐字节往返一致；只读查看器（自由点、自由点间线段） |
| 全语料 EMF/HTML 导出 | **540/1,431 完成**（全部成功），输出在本机 `oracle/full/`（不入库），`manifest.jsonl` 可续跑 |
| 规格问题 | `spec/questions.md` 有 Q1–Q3，均未回答，不阻塞 M2 |

未验证：安装包没在 Windows 10 上装过；查看器没在运行中的程序里实际打开文件（需要用户手动点文件对话框）。

## 2. 必须遵守的约定

1. **洁净室**：实现方（`impl/` 里写代码的 agent）只读 `spec/`、`impl/`、`samples/baseline/`、`PLAN.md`、`README.md`，规则全文在 `impl/CLAUDE.md`。每个实现方 worker 的任务书里都要写明这一条。
2. **版权**：仓库公开，`.gitignore` 里列的第三方内容只留本机，不能提交。
3. **原版几何画板**：**任何会启动原版（`oracle/runtime/GSP5chs.exe`）的操作，包括续跑导出，事先都要问用户**，建议挑用户不用电脑的时候；进程死了不要自动重启。上一轮因为反复自动续跑，原版窗口一直弹出，打扰了用户。
4. **worker 出错**要记在 `worker-errors/`（模板见该目录 README）：写清任务、模型、现象、原因、处理、结论。
5. worker 不做改变状态的 git 操作，由主 agent 审查后提交。**不要让 worker 结束“所有进程”**，只能结束它自己启动的进程（上一轮有一次导出被外部结束，疑似 worker 清理时波及）。
6. 提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 3. 人手：主 agent + 最多 3 个子 agent

主 agent 负责规划、审查、合并、记录错误，不亲自写大块代码；worker 出了问题直接介入修复。上一轮的模型经验：

| 任务类型 | 用过的模型 | 结果 |
|---|---|---|
| 照着现成原型移植脚本 | Haiku | 一次通过 |
| 在现成 API 上做界面 | Haiku | 一次通过（没做实机点击验证） |
| 综合资料写规格 | Sonnet | 质量高，但很贵（约 74 万 token、48 分钟） |
| GUI 自动化 | Sonnet | 一次通过 |
| 核心解析/写出 | Sonnet | 一次通过（中途会话中断，用 SendMessage 续上） |

建议：规格综合、几何内核用 Sonnet；任务书写清楚、有现成接口的用 Haiku。

## 4. 下一步：M2 基础几何与拖动

目标见 `PLAN.md` 第 6 节 M2 行：附录 A 的 A 组 25 种对象能正确求值、绘制、拖动，并和原版 EMF 对照一致。分三条线，前两条可以同时开工。

### W1 规格：A 组对象卡片（Sonnet，规格方）

产出 `spec/objects/cards/<ext_id>.md`，A 组 25 种：外部 ID 0–15、63、64、79–83、93、98，先做量最大的 0、2、15、9、5、3、8、63、64、6、1、12、11。每张卡写：父对象签名（结合 `catalog.json` 的父模板词和语料里实际的父对象类型）、数学定义、不存在的条件、参数化方式、能否拖动、默认样式、2003 附加参数的字段（约束 15 有 2003）。

要靠对照数据定下来的点：交点 11/12、13/14 的“第一个/第二个”怎么区分；路径上的点（15）在各种路径上的参数定义（读 2003）；角平分线和弧的方向约定。手段按优先级：已导出的 540 个 EMF/HTML → 定向看原程序 → 新的原版实验（要先问用户，见第 2 节第 3 条）。

### W2 规格：EMF 对照与验收用例（Sonnet，规格方）

1. 写 `tools/emf_match.py`：把一个文件的 EMF 图元和文档对象对应起来。已知 EMF 是 600 dpi 的 EMF+ 双格式，坐标除以 6.25 得到 96 dpi 像素，和文档坐标是 1:1，平移量要靠拟合（用自由点匹配），细节见 `tools/oracle/README.md`。HTML 导出带对象次序和 `[hidden]` 标记，可以帮助对应。原版先画线、后画自由点。
2. 用已有的 540 个导出生成 `spec/acceptance/m2/`：对每个文件，列出 A 组对象（且祖先都在 A 组内）的期望坐标/几何参数，格式由 W2 定，写进 `spec/acceptance/README.md`。验收脚本要能拿实现方程序的输出比对，按容差判定。
3. 顺手回答 `spec/questions.md` 的 Q1–Q3（能答的就答，答案移进 `spec/format/gsp-format.md`）。

### W3 实现：M2 几何内核（Sonnet，实现方，W1 交第一批卡片后开工）

在 `impl/packages/core` 里加依赖图、按构造次序求值、存在性传播、自由点拖动后重算后代；`impl/packages/render` 画 A 组对象（样式字 w0/w1/w2 的含义没定，先按规格里“像”的说法画，等卡片确认）；查看器支持拖动自由点。验收：W2 产出的 M2 用例全部通过；基准样本 `midpoint.gsp` 拖动后与 `midpoint-moved.gsp` 一致（中点期望从 (311,214) 到 (331,227.5)）。

### 主 agent 自己做

- 审每个 worker 的交付，跑 `impl/` 的 `npm run typecheck`、`npm test`，规格类交付抽查原文。
- 剩下的约 890 个文件导出，**先问用户**同意和时间，再执行：
  `tools/oracle/.venv/Scripts/python.exe tools/oracle/gsp_oracle.py batch --list "original/sketchpad5/**/*.gsp" --out-dir oracle/full --resume --timeout 120`
- 有空可以请用户装一次安装包（`impl/packages/desktop/src-tauri/target/debug/bundle/nsis/`），打开 `samples/baseline/samples/midpoint.gsp` 看查看器显示，补上 M1 的实机验证。
- M2 收尾时更新 `PLAN.md` 的进度、改写本文件。
