# M5 第三批与 M3 编辑闭环

基线为2026-10-24已合并PR #5/#6的main提交`c9775a4`。本批分支`codex/m5-batch3`。验收与规格在原始检出，产品实现由独立的sparse洁净室检出完成。函数与62规格、坐标证据、编辑闭环并行；共享core入口由一个实现者集成。

## 1. 冻结基线

正式旧集合`oracle/m5-cases-r5`保持不变。复跑命令与原样输出保存在`oracle/work/m5-batch3/`，结果如下：1430例、12818条原版断言，通过11903、incorrect_result=0、自身未支持22、祖先阻塞893。10552条几何及1351条读数通过；全部页对象ok=211866/344417，完全支持活动页39/1430。

`tools/m5_batch3_audit.py snapshot`保存索引及1430个用例的SHA-256；结束时verify必须仍一致。`exclusions`只统计既有证据的排除项，不调用产品求值器：139307条排除，348个文件有1024个尚未导出的其它页场景。隐藏、剪裁、重复图元、未覆盖依赖等仍是覆盖缺口，不因没有反例而视为通过。

## 2. 范围与规格

- 函数与约束62分开研究，见`m5-batch3-functions.md`和`../features/m5-functions.md`。62属于动作按钮族，不纳入本批产品实现。
- 坐标新增子集及直接原版证据见`m5-batch3-coordinates.md`和卡片94/59；证据不足分支保留未支持。
- 编辑闭环依`../features/m3-editor-closure.md`：拖动事务、按文档跨页历史、字节检查点修改状态、另存为与重开。新对象构造和完整工具箱不在本批。

## 3. 独立验收与集合合并

`tools/m5_merge_cases.py`对既有原版用例做并集，重复对象期望冲突直接报错，不用实现值填期望。r5和旧指定页32例合并后为1461个独立页场景、13162条断言；相对r5多344条（336几何、8读数）。这些是先前已导出的非活动页证据统一纳入索引，不是本批新启动原版或新采集的32页。按source/page/operation/object去重，已有期望改变0、删除0。

## 4. 交付验收（2026-10-24）

从原始检出根目录离线执行，未启动 GSP5chs.exe。Python 为 `tools/oracle/.venv/Scripts/python.exe`。

```powershell
cd impl; npm run typecheck; npm test; cd ..
node tools/m5_batch1_dump.ts oracle/m5-cases-r5/index.json oracle/work/m5-batch3/impl-dumps
& $py tools/check_m2.py --index oracle/m5-cases-r5/index.json --actual-dir oracle/work/m5-batch3/impl-dumps --report oracle/work/m5-batch3/impl-report.json
& $py tools/m5_batch1_summary.py --index oracle/m5-cases-r5/index.json --report oracle/work/m5-batch3/impl-report.json --dump-dir oracle/work/m5-batch3/impl-dumps --out oracle/work/m5-batch3/impl-summary.json
& $py tools/m5_batch2_audit.py --index oracle/m5-cases-r5/index.json --dumps oracle/work/m5-batch3/impl-dumps --baseline-report oracle/work/m5-batch3/baseline-report.json --report oracle/work/m5-batch3/impl-report.json --out oracle/work/m5-batch3/impl-audit.json
node tools/m5_batch1_dump.ts oracle/work/m5-batch3/r5-with-pages/index.json oracle/work/m5-batch3/unified-dumps
& $py tools/check_m2.py --index oracle/work/m5-batch3/r5-with-pages/index.json --actual-dir oracle/work/m5-batch3/unified-dumps --report oracle/work/m5-batch3/unified-report.json
node tools/m5_batch1_dump.ts oracle/m5-batch3-functions/index.json oracle/work/m5-batch3/fn-dumps
& $py tools/check_m2.py --index oracle/m5-batch3-functions/index.json --actual-dir oracle/work/m5-batch3/fn-dumps --report oracle/work/m5-batch3/fn-report.json
node tools/m5_batch1_dump.ts oracle/m5-batch3-coordinates/index.json oracle/work/m5-batch3/coord-dumps
& $py tools/check_m2.py --index oracle/m5-batch3-coordinates/index.json --actual-dir oracle/work/m5-batch3/coord-dumps --report oracle/work/m5-batch3/coord-report.json
```

| 集合 | 用例 | 断言 | 通过 | 算错 | 自身未支持 | 祖先阻塞 |
|---|---:|---:|---:|---:|---:|---:|
| r5（冻结基线） | 1430 | 12818 | 11903 | 0 | 22 | 893 |
| r5（本批实现） | 1430 | 12818 | **11950** | **0** | 6 | 862 |
| r5 + 指定页（本批实现） | 1461 | 13162 | **12290** | **0** | 6 | 866 |
| 函数专用子集 | 7 | 14 | 6 | 0 | 0 | 8 |
| 坐标专用子集 | 10 | 17 | **17** | 0 | 0 | 0 |

- r5 增量 +47：约束 48 从 816 到 839（+23，函数调用），94 从 107 到 131（+24，13 多边形 + 2 弧 + 9 下游）。两类均无算错。
- 几何与读数零退步：`impl-audit.json` 记 10552 条几何、1351 条读数此前通过且仍通过，`regressionCount=0`。
- 6 条自身未支持：3 条 94 重边多解，2 条分形 `dimension-mismatch-unverified`，1 条分形 `value-undefined:power-domain`；均为规格明列的未验证边界。
- 函数子集 8 条阻塞的祖先分别是 55、56、89（轨迹/迭代族），阻塞链中没有函数容器自身；自由函数 284 个中 mode 0 的 276 个全部识别为可调用容器，mode 1/2/3 的 8 个报 `function-mode-unverified`。
- 全语料 843 个含调用 token 的 48 里，230 个只直接调用自由函数；其中 88 个当前可求值，其余按父未实现、函数体单位后缀、数值域、量纲不符分别记录，没有新增猜测值。

覆盖率（`impl-audit.json`）：对象 ok **213174 / 344417（61.9%）**，基线 211866；完全支持的活动页 **39 / 1430**，与基线相同（剩余页仍有轨迹、迭代、按钮等未实现对象）。这两个数不能推成全文件或 M5 已完成。

已有期望逐项审查：r5 索引内的原版期望**改变 0、删除 0**（`m5_merge_cases.py` 对重复对象冲突直接报错，未用实现值覆盖）。实现单元测试有 4 处旧期望随规格放开而调整，全部登记在此，无其它改动：`core/test/coordinates.test.ts` 的 59 水平轴由 `parameterizationKnown:false` 改为 `true`，并把原来"59/60 一律拒绝"的用例拆成"水平 59 接受、竖直 59 与 60 仍拒绝"两条；`core/test/measure.test.ts` 的 `[0x7000,1,RPAREN]` 由 `expression-unsupported:0x7000` 改为 `function-call-unavailable`，`[0x000F]` 由 `function-object-unverified` 改为 `function-mode-unverified`（同一身份下先判模式）。四处都对应本批新语义，未放宽任何数值容差。

测试与检查：`npm run typecheck` 三个工作区通过；`npm test` **526 项**（app 54、core 440、render 32，0 跳过）；工具单测 **71 项**通过、0 跳过（`test_emf_match` 14、`test_m5_measures` 11、`test_m5_numeric_hints` 4、`test_m5_coords` 17、`test_m5_batch3_audit` 4、`test_m5_batch3_coords` 10、`test_m5_functions` 8、`test_m5_merge_cases` 3；每个文件按 CI 方式从仓库根单独运行，本机有 oracle 时证据保真用例不跳过）。桌面 `tauri build --debug` 产出 NSIS 安装包；Windows 11 本机安装与启动验证沿用已有记录，Windows 10 干净环境仍未验证，单列不阻塞本轮。

## 5. 编辑器闭环验收

产品契约见 `../features/m3-editor-closure.md`，测试在 `impl/packages/app/test/editor.test.ts`（39 项 app 新增用例中的主体）。覆盖：

- 一次拖动内多次 move 只提交一步；移回起点不提交；`pointercancel`、`Escape`、`lostpointercapture` 恢复起点且不新增历史。
- 跨页共享历史，undo/redo 自动定位原页；撤销后新编辑清空重做；同历史深度不同分支仍为脏，回到保存字节则干净。
- 另存为取消、写失败、成功后重开；保存期间后续编辑仍为脏；重复保存与打开互斥；非 `.gsp` 目标被拒；保存前提交进行中的实际拖动。
- `midpoint.gsp` 拖动对象 1 由 (211,147) 到 (251,174)，中点更新，另存为后重开保留目标自由点、派生中点、未知记录与未编辑页；未修改文档另存为逐字节相同，撤销全部后恢复原字节。

本批不含新建构造、删除、文本/属性、多选、新增页面和窗口关闭前提示，均未实现。

## 6. 可复跑步骤

从原始检出根目录执行；Python为`tools/oracle/.venv/Scripts/python.exe`。全程离线，不启动原版。

```powershell
node tools/m5_batch1_dump.ts oracle/m5-cases-r5/index.json oracle/work/m5-batch3/baseline-dumps
& tools/oracle/.venv/Scripts/python.exe tools/check_m2.py --index oracle/m5-cases-r5/index.json --actual-dir oracle/work/m5-batch3/baseline-dumps --report oracle/work/m5-batch3/baseline-report.json
& tools/oracle/.venv/Scripts/python.exe tools/m5_batch3_audit.py snapshot --index oracle/m5-cases-r5/index.json --out oracle/work/m5-batch3/r5-snapshot.json
& tools/oracle/.venv/Scripts/python.exe tools/m5_batch3_audit.py verify --index oracle/m5-cases-r5/index.json --snapshot oracle/work/m5-batch3/r5-snapshot.json --out oracle/work/m5-batch3/r5-verify.json
```

比较器非零退出可能是明确未支持，必须读分类结果；不能把非零统一当算错，也不能把算错改称未支持。Windows10干净环境验证仍单列，当前环境为Windows11。
