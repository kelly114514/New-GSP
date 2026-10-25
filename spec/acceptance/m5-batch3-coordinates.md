# M5第三批：坐标剩余边界的离线证据

本批只读既有原版存档、EMF/HTML；没有启动原版。实现只读本报告和对象卡片，不能读取oracle或第三方参考资料。原版期望保留原图元/显示文字；独立工具不import/call impl，不改r5。

## 1. 已确认的可实现子集

权威契约见[94卡片](../objects/cards/94.md)。94新增可实现范围限于原生8多边形、原生80普通弧，且P已在边界上、最近逻辑值唯一。多边形按父序累计边长/周长；同一非接缝顶点两边给同一参数可合并，接缝0/1不合并，重合边上不同参数仍unsupported。80弧按第一端点起沿有向扫角的比例，B端为1。

初步直接读数证据：13条唯一逻辑值多边形、2条80弧，均来自r5已有原版显示文字，期望不变。另有3条重边多解、2条缺点几何的多边形读数，继续未支持，不用多解恰好吻合某个候选来宣称规则已知。

## 2. 索引与可复跑命令

独立工具 `tools/m5_batch3_coords.py` 生成 `oracle/m5-batch3-coordinates`（10 个 case / 17 条断言），只读 r5、冻结的 32 页索引和本次已导出的原版图元；没有表达式求值器，不 import/call 产品实现。

```powershell
python tools/m5_batch3_coords.py --out-dir oracle/m5-batch3-coordinates
python -m unittest discover -s tools -p test_m5_batch3_coords.py -v
node tools/m5_batch1_dump.ts oracle/m5-batch3-coordinates/index.json oracle/work/m5-batch3/coord-dumps
tools/oracle/.venv/Scripts/python.exe tools/check_m2.py --index oracle/m5-batch3-coordinates/index.json --actual-dir oracle/work/m5-batch3/coord-dumps --report oracle/work/m5-batch3/coord-report.json
```

| 子集 | 断言 | 期望来源 |
|---|---:|---|
| 94 多边形逻辑值 | 13 | r5 已有原版显示文字，逐字段原样复制 |
| 94 普通 80 弧逻辑值 | 2 | 同上 |
| 15 在水平 59 轴上 | 1 | 本次新读的原版 EMF 点（`M集框架.gsp` 页 1 对象 64） |
| 15 在 59 轴平行线 6 上 | 1 | 本次新读的原版 EMF 点（同页对象 27） |

合计 17 条；其中 15 条是 r5 已有读数的只读副本，2 条是新原版点断言。两者不重复计入 r5 的 12,818 条。产品实现当前 17/17 通过（`coord-report.json`：passed 17、0 失败）。

多边形读数分布：18 条候选里 13 条通过，3 条 `polygon-nearest-logical-value-ambiguous`（重边多解），2 条因父几何无法独立取得而未纳入断言。弧 2 条全部通过，另有 79/81/变换弧不在本子集。

## 3. 轴点证据

`M集框架.gsp` 页 1：59 水平轴 11 的原生记录 `01000000`，父原点 7=(647,243)，长度父是 48/genera 48 的计算对象 10，L=75.5905511811 px。路径点 64 的原生 t=1.82，按水平 200 px 基预测 (911,243)，新读原版点 (910.999944,243.000107)，误差 0.00012 px；另一个点是 59 轴上平行线 6 的路径点 27（自由点 22=(462,365)，t=2.37），预测 (836,365)，原版 (835.999944,365.000107)。

两个点的身份绑定都没有使用参数预测：一个由标签加独立入射关系唯一确定，另一个由水平平行线加垂直入射唯一确定；对齐用 4 个自由点做颜色/平移投票。原版清单 `busy_after_open`、`animation_stop_sent` 均为空，`dialogs=[]`。

61 的存档模式字分布为 0:7、1:1400、2:274；本批仍只支持 1/2，模式 0 与其它组合继续未支持。69 的带单位坐标父审计了 5 个对象，全部因父几何或读数不可得而未纳入断言，仍不放开。

## 4. 仍未支持

59 竖直轴、60 两个方向、59 轴的变换像、坐标轴上的 94 逻辑值、非 80/81/变换弧、多边形接缝 V0、重边多解、圆心的最近点多解、离边界/离弧的点、69 带单位父、61 模式与斜轴/不同原点/错序轴、刻度与网格：全部报 `unsupported` 并写明 reason。没有为了覆盖率把它们改成有限值。
