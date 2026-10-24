# M4 第一批验收与原版实验（2026-10-24）

## 产品验收

实现约束16、17、21、27、28、30、32、34、75，变换现有点、线段/射线/直线、圆、弧、多边形及内部。反射保留有向弧语义；75目前仅复制几何并沿用已存颜色。路径点15补齐垂线/平行线的半向量基点。

- `npm run typecheck`通过；`npm test`共275项通过（app15、core229、render31），包括本机语料往返与引用检查。
- 原有`oracle/m2-cases-r2`的1430例、9884条原版EMF断言全部通过：A组7389，C组2495。没有缺失几何，也没有数值反例。仍有115659个A组对象没有对应断言（含其它页等缺口），`fullM2Accepted=false`。
- 新导出example-46全部4页，以及另10文档的28个非活动页。32页生成352条几何断言与8条度量断言；352条几何全部通过。8条度量属于M5未实现，其中3条自身未实现、5条由未实现祖先阻塞；不是M4几何错误。
- 新页批次统计不是全语料覆盖率：其中example-46第1页与旧集合重叠。按`(source,pageIndex,objectIndex)`去重，旧9884条与新352条重叠16条，新增336条，合计**10220条唯一几何断言全部通过**。

所有对照沿用自由点独立平移拟合；没有启用按预测图元打分的备用对齐。无原版图元的对象不伪造期望。

M5规格方另以严格文字规则生成`oracle/m5-cases-r2/`：1430例保留原有9884几何断言，新增2334条显示读数（计算48为1337）。106条可取独立原版父几何的常用度量定义核对全部一致；完整协议与覆盖局限见[m5-measures.md](m5-measures.md)。本轮M4没有实现这些数值对象，不把新增期望算为产品通过。

## 可复跑的非活动页导出

`tools/oracle/export_pages.py`在临时输入副本的900头，仅改活动页u16（文件偏移28），原版打开该页并输出EMF/HTML；不通过屏幕坐标点击页签。原件及几何数据不变。manifest的`pageIndex`为0起，验收用例的`pageIndex`仍为1起，匹配器显式转换；manifest同时记录原件和临时副本哈希、原活动页、选择方法。

```powershell
$py = 'tools/oracle/.venv/Scripts/python.exe'
& $py tools/oracle/export_pages.py --list 'original/sketchpad5/Samples/4.x实例/官长寿作品/杂例/example-46.gsp' --out-dir oracle/pages-example46 --pages all --keep-work-files --resume
& $py tools/emf_match.py batch --manifest oracle/pages-example46/manifest.jsonl --manifest oracle/pages-batch1/manifest.jsonl --out oracle/m4-pages-cases
& $py tools/check_m2.py --index oracle/m4-pages-cases/index.json --report oracle/m4-pages-report.json --runner node impl/packages/core/scripts/geometry-dump.ts '{input}'
```

最后一个命令包含M5未实现的度量，因此仍返回非零。报告按失败种类读取，不能称为全部产品功能通过。`oracle/multipage-batch1.txt`为本机批次清单，输出与第三方派生用例均不入库。`test_export_pages.py`对全部1431个语料和基准检查页数、边界以及副本只改两个字节的隔离性质。

## 五项原版实验

原版均为哈希校验的本机授权副本。除第5项外，弧边界通过合成输入再由原版打开/导出；这是原版对指定存档状态的行为证据，不是原版菜单允许创建该状态、连续拖动或撤销的证据。脚本`tools/oracle/make_boundary_fixtures.py`保留可复跑的合成规则，依赖本项目自建的point基准环境，不包含第三方文档字节。

| 实验 | 输入及观察 | 能确认的结论 / 局限 |
|---|---|---|
| 80两半径不等 | O=(300,300)，A=(450,300)，B=(300,150)/(300,90)：弧半径均150；A=(510,300)、B=(300,150)：半径210；均90°，无打开警告 | 半径取OA，B只给方向；不确认菜单等距门槛 |
| 79端点离圆 | 父圆中心(300,300)、半径150；B=(300,90)，A=(450,300)/(510,300)：弧半径150/210，父圆均150；均90°，无打开警告 | 修正旧卡片过强的“半径始终取父圆”说法：正常圆上端点无法区分，离圆输入取OA |
| 81共线分界 | A=(300,300)、B=(600,300)，M=(450,300)/(450,299.9)/(450,299.64)均输出AB线段；M=(450,299.62)输出r≈29605.4523的弧；M=(650,300)无弧/线段 | 有线段退化分支；阈值只被夹定，半径/圆心坐标阈值与等号未分清；未绘制不等于不存在 |
| example-46零扫角 | 第2–4页有可见同方向80，EMF无弧、圆图元；第1页有5条弧，作为正对照 | 显示上不是整圆；对象存在性、路径、交点语义仍未知 |
| 变换像拖动 | 原版箭头拖动16的蓝色平移像，源点(250,180)变为(300,210)，向量端点仍(250,350)/(350,390)；保存后解析源点及父引用确认 | 至少平移点支持反向拖源点；不能外推到其它8类。产品本轮仅保证拖自由点时更新后代 |

弧输出在本机`oracle/boundary-exports`、`boundary-extra-exports`、`boundary-v3-exports`。79的最终复核用v3输入（圆genera28）；早期探索输入的圆genera字段不正确，没有用它单独定稿。正常与非对称输入均复核原版实际圆/弧半径。零扫角输出在`oracle/pages-example46`。变换拖动保存证据在`oracle/boundary-inputs/transform16-drag.gsp`，未拖动的对照在`oracle/boundary-inputs-v3/transform16-drag.gsp`。

## 安装与前台验证

在当前Windows主机用本轮代码构建NSIS安装包，实际安装并启动安装后的程序，通过文件对话框打开`midpoint.gsp`：4对象均绘制，0暂不支持；两个红色端点、深蓝线段、红色中点位置正确。拖动第一端点后，源点从(211,147)变为(231,162)，中点随之移动，另一端点保持原位。基准原文件未保存改动。

这补足了查看器前台冒烟验证；主机为Windows11家庭中文版（10.0.26200），不代表已在另一台干净Windows10机器或不同DPI环境测试。随后构建并重新安装release NSIS（约3.88MiB），启动后没有debug控制台；在安装后的release中打开平移16样例，源点从(250,180)拖到(270,195)，蓝色平移像同步移动，向量两端不动。首次debug安装与后续release验证分别记录，不把编译成功冒充前台验证。最终安装包位于`impl/packages/desktop/src-tauri/target/release/bundle/nsis/GSP-plus_0.1.0_x64-setup.exe`，不入库。

## 留待后续

零比例、32非共线、75动态颜色数值、22及参数来自度量的其余变换仍未支持。新确认的79/80离圆输入与81精确边界不扩入本轮M4实现；卡片已记录结果，供下一轮补实现与验收。样式、标签和隐藏对象的完整验证仍未达成。
