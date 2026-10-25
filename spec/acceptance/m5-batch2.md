# M5 第二批：坐标系与坐标度量

2026-10-24，分支 `codex/m5-batch2`，基于未合入PR #5的 `codex/m5-batch1`，PR目标也是第一批分支。本轮只离线读取既有原版EMF/HTML与存档，未启动原版。

## 1. 范围与实现契约

新增52/54卡片，补全58–61/65/66/69/86/94；实现经确认的直角坐标子集、单位点、绘制点、坐标度量、94的普通线段/射线/直线/圆。另修15在58轴上的原生参数基，以及语料魔数测试仅读4字节，避免全文件I/O引发5秒超时。

各卡片是权威定义；数值输出、精度、量纲与存在性传播沿用[m5-measures.md](m5-measures.md)。页面x向右/y向下，数学正y向上。坐标无量纲，10041/10042不直接参与；length数值父先换成未舍入页面px。父不存在传播not-existing；未实现父传播unsupported/parent:N:unsupported。未知边界必须报未支持，不能猜有限值。

轴保留line几何a=原点、b=正单位点和axis元数据；61输出coordinate-system语义容器，渲染器安全忽略，两轴独立处理。刻度、网格、标签排版不在本批验收范围；52/54不作为自由点拖动，未新增15拖动入口。

| 约束 | r4原版直接断言 | 通过 | 自身未支持 | 祖先阻塞 | 证据/状态 |
|---:|---:|---:|---:|---:|---|
| 52 | 125 | 125 | 0 | 0 | 已验收子集 |
| 54 | 1 | 1 | 0 | 0 | 已验收子集 |
| 58 | 2 | 2 | 0 | 0 | 已验收子集 |
| 59 | 0 | 0 | 0 | 0 | 仅静态证据；另有间接读数核对，不称完成 |
| 60 | 0 | 0 | 0 | 0 | 仅静态证据；另有间接读数核对，不称完成 |
| 61 | 0 | 0 | 0 | 0 | 仅静态证据；另有间接读数核对，不称完成 |
| 65 | 137 | 74 | 0 | 63 | 已验收子集 |
| 66 | 148 | 105 | 0 | 43 | 已验收子集 |
| 69 | 29 | 29 | 0 | 0 | 已验收子集 |
| 86 | 226 | 30 | 0 | 196 | 已验收子集 |
| 94 | 163 | 107 | 19 | 37 | 已验收子集 |

表中非零断言仅证明已验收子集，不代表所有父链或边界都支持。59/60/61直接断言为0，不能写完成；其中61无独立可见EMF图元。它们有结构和下游数值证据，详见§2。

## 2. 离线证据与证据等级

- 〔已验证：原版EMF/HTML数值〕`tools/m5_coords_evidence.py oracle/m5-cases-r4 --out oracle/work/coords-evidence-r4.json`：65横坐标80、66纵坐标110、86坐标距离33，共223个公式诊断对原版文字0失配。94共106个（普通线段65、变换线段24、射线8、直线7、圆2），0失配。诊断值不生成期望，也不调用impl。
- 同命令的轴祖先核对：58有426次、59有8次、60有12次，0失配；这是间接核对，不能当作59/60直接图元断言。旧r3同命令的220个坐标读数、105个94读数也均0失配，输出在`coords-evidence-r3.log/json`。
- 〔已验证：原版EMF/HTML数值〕52的125个原版点、54的1个点、58的2条轴线、69的29个绘制点由`emf_match.py batch`唯一图元绑定读回，全部通过。预测只挑唯一图元，期望始终从原版图元读回；没有impl依赖或实现结果回填。
- 〔已验证：原版EMF/HTML数值〕同一坐标证据脚本检查了36个15轴上点，全部父为58，固定页面px参数式与原版点0失配。59/60的15路径参数基没有独立样本，保留未支持，不从同主类外推。
- 〔结构〕上述脚本扫描活动页HTML：UnitPoint616、SquareUnitPoint580、HorizontalAxis1153、VerticalAxis1148、CoordSysByAxes1141、PlotXY1453。唯一父图绑定：2309首u16=1对应424个水平轴、=0对应398个竖直轴，含2/4字节布局；第二u16=1的9个轴仍水平。原生69父序为[X,Y,K]，HTML是PlotXY(Y,K,X)，按有序槽转换，不能排序抹掉方向。
- 〔结构〕54父是52，不是原点；缓存不覆盖父52当前长度。例如`Samples/4.x实例/官长寿作品/平面应用/example-56.gsp`对象33的54缓存37.79527559055118，父32的52长度14.79527559055117；HTML是无独立长度参数的SquareUnitPoint。几何与下游数值按父当前长度核对；并未做修改缓存的原版实验。
- 〔已验证：原版EMF数值〕`tools/m5_specs_evidence.py oracle/m5-cases-r4 --out oracle/work/evidence-r4.json`：独立原版父图元度量核对120个（36:10、37:46、40:1、41:7、46:3、47:53），0失配。旧r3的106个另用同脚本复跑，0失配；已有期望及原版父图元均未改变，r4额外14个。3个舍入半值逐字仍一致，不扩大到负半值规则。
- 〔静态：手册或目录〕94“最近点”概念、未覆盖路径的概念定义保留静态等级；复杂路径、边界多解和未知模式不据此输出值。

## 3. 正式验收结果与回归

主索引1430例，共12787条原版断言：**通过11872（几何10521、读数1351），incorrect_result=0**；自身未支持22，被未实现祖先阻塞893。所有几何断言通过。

r3几何10026条、此前通过的442条读数全部继续通过，回归0。为避免使用首次交付r2报告冒充r3，基线由提交`e59eaaa`的core源码在本机独立目录重新dump r3，复现10468通过/125自身未实现/1699阻塞/0算错；基线报告与dump存`oracle/work/report-r3-baseline.json`、`dumps-r3-baseline`。基线重跑只用于验收，不参与预测或生成期望。

新增页索引`oracle/m4-pages-cases`：356通过、0失败、4阻塞（r3为355通过/5阻塞），没有退步。

typecheck的app/core/render三个工作区均通过；`npm test`本机462项通过（app15/core415/render32，0跳过）。工具单测51项通过（EMF匹配14、度量11、旧数值提示4、新坐标/差异/审计/汇总15、生命周期5、指定页2）；另有30项离屏GDI检查与比较器自测（6个原版baseline夹具）全部通过。新工具测试已加入CI原同一步。

22个自身未支持：94多边形17、94弧2；48量纲不一致2、幂运算数值域未支持1。其余893条是明确祖先阻塞，不计通过。明细在`oracle/work/unimplemented-r4.json`；未把算错改成未支持以凑0。

## 4. r3→r4差异

`tools/m5_case_diff.py oracle/m5-cases-r3 oracle/m5-cases-r4 --out oracle/work/diff-r3-r4.json`：已有期望值改变**0**，删除**0**，新增**495**，全部为原版几何断言；原有2266条显示读数的期望全部保留。按(source,page,operation,object)比较，保护kind/constraint/exists/geometry/measurement/tolerance/appearance，仅允许provenance元数据变化。没有删除类别需要归因。

| 新增 (kind,约束) | 数量 |
|---|---:|
| `('arc', 81)` | 2 |
| `('circle', 3)` | 7 |
| `('line', 58)` | 2 |
| `('point', 1)` | 2 |
| `('point', 15)` | 133 |
| `('point', 16)` | 7 |
| `('point', 17)` | 1 |
| `('point', 21)` | 1 |
| `('point', 27)` | 2 |
| `('point', 30)` | 4 |
| `('point', 33)` | 2 |
| `('point', 34)` | 4 |
| `('point', 52)` | 125 |
| `('point', 54)` | 1 |
| `('point', 69)` | 29 |
| `('point', 75)` | 5 |
| `('point', 9)` | 2 |
| `('polygon', 8)` | 7 |
| `('segment', 16)` | 2 |
| `('segment', 2)` | 155 |
| `('segment', 27)` | 1 |
| `('segment', 30)` | 1 |

24/29/33分别有7/2/9条原版几何断言，全部通过；坐标数值下游的线段、交点、变换像等也直接接受原版图元断言。其它未产生唯一匹配的隐藏、剪裁、重复图元仍记coverage gap，不用预测值补期望。

## 5. 覆盖率（真实口径）

| 指标 | r3 | r4 |
|---|---:|---:|
| 全部页对象status=ok（分母344417，不含工具区） | 173942（50.5%） | 211873（61.5%） |
| 活动页每个对象都ok或确定不存在 | 37/1430 | 39/1430（2.7%） |
| 算错 | 0 | 0 |

对象ok增加37931，完整活动页仅增加2；不能把对象覆盖提升当作M5或全文件兼容已完成。r4全部页另有unsupported=122297、not-existing=10247。目前主要缺口仍有62、自由文本/函数、35/67/71/89/90/95，以及计算单位/数值域等边界。

修正旧汇总器一处统计错误：旧`casesWithAllAssertionsPassing`未排除祖先阻塞页面，名称与统计含义不符。本轮已加回归测试，正确r4值为1258；这与严格的39个完全支持活动页是两种指标，均不冒充所有页面支持。

## 6. 首轮27条错误的证据归因与修复

原样初始报告为`oracle/work/report-r4-initial.json`、`check-r4-initial.log`，失败期望/实际/父图明细为`failures-r4-initial.json`。相关原版清单busy_after_open、animation_stop_sent均无异常记录，dialogs=[]，不能归因动画。

根因是主agent首版规格混淆轴单位基与15路径基。`割圆为方详解(inRm).gsp`页1 O=(105,203)、L=37.79527559055118；对象7 t=1.445，原版点(294,203)；对象9 t=1.255，原版点(105,354)，共同确认固定200px、页面正向参数基。按卡片15修值后，27条均恢复通过，未删改断言，也未将这27条改为未支持。主agent规格错误记录见[worker-errors](../../worker-errors/2026-10-24-m5-batch2-axis-parameter.md)。

另行收紧两种无原版证据的有限输出：94的轴逻辑值（语料3对象）和15以59/60为父的参数基（当前dump3对象）；都没有本轮直接原版断言，没有把这些未知分支算作兼容完成。其定义缺口已分别写入卡片94/15、Q12与建议实验，不从15存储参数或同主类外推。

## 7. 仍未支持与建议原版实验

〔未知〕非正/反向单位、斜轴/不同原点/错序轴、61非1/2模式/未知记录、69带单位坐标父、54非52父、94轴/弧/多边形/函数/轨迹/圆心多解、15的59/60轴父均显式未支持。存在性未核证时也不猜“确定不存在”。52/54反向拖动与刻度/网格/标签排版未验收，保留原记录。

建议下轮经用户授权后分别实验：上述轴边界；59/60的15参数基；94轴逻辑点值、弧端点、多边形接缝/多解；69带单位参数；单位点拖动及61其它模式/网格。每次保留存档、EMF、HTML，记录动画/停止/保存提示。**本轮没有启动原版。**

## 8. 洁净室与复跑

主agent编写规格、独立预测/差异/证据/审计工具并验收；实现交给单个独立洁净室子agent，输入仅spec文件章节，在只含spec/impl/samples与允许根文件的sparse检出中工作。未给它oracle原文或第三方代码。只有它修改产品文件；共享geometry.ts未并发修改。子agent具体模型型号未知，如实记录，未伪造Co-Authored-By。

原样命令输出存`oracle/work/`：`typecheck-r4.log`、`npm-test-r4.log`、`generate-r4.log`、`dump-r4.log`、`check-r4.log`、`summary-r4.log`、`pdump-r4.log`、`pcheck-r4.log`、`evidence-r4.log`、`coords-evidence-r4.log`、`diff-r3-r4.log`、`audit-r4.log`、`test-*-r4.log`。oracle、original、第三方内容与.workbuddy均不提交。

```powershell
$py = 'tools/oracle/.venv/Scripts/python.exe'
cd impl; npm run typecheck; npm test; cd ..
& $py tools/emf_match.py batch --manifest oracle/full/manifest.jsonl --out oracle/m5-cases-r4
node tools/m5_batch1_dump.ts oracle/m5-cases-r4/index.json oracle/work/dumps-r4
& $py tools/check_m2.py --index oracle/m5-cases-r4/index.json --actual-dir oracle/work/dumps-r4 --report oracle/work/report-r4.json
& $py tools/m5_batch1_summary.py --index oracle/m5-cases-r4/index.json --report oracle/work/report-r4.json --dump-dir oracle/work/dumps-r4 --out oracle/work/summary-r4.json
node tools/m5_batch1_dump.ts oracle/m4-pages-cases/index.json oracle/work/pdumps-r4
& $py tools/check_m2.py --index oracle/m4-pages-cases/index.json --actual-dir oracle/work/pdumps-r4 --report oracle/work/preport-r4.json
& $py tools/m5_specs_evidence.py oracle/m5-cases-r4 --out oracle/work/evidence-r4.json
& $py tools/m5_case_diff.py oracle/m5-cases-r3 oracle/m5-cases-r4 --out oracle/work/diff-r3-r4.json
& $py tools/m5_coords_evidence.py oracle/m5-cases-r4 --out oracle/work/coords-evidence-r4.json
& $py tools/m5_batch2_audit.py --index oracle/m5-cases-r4/index.json --dumps oracle/work/dumps-r4 --baseline-report oracle/work/report-r3-baseline.json --report oracle/work/report-r4.json --out oracle/work/audit-r4.json
```

工具测试逐项运行：`test_emf_match.py`、`test_m5_measures.py`、`test_m5_numeric_hints.py`、`test_m5_coords.py`；另运行`tools/oracle/test_lifecycle.py`、`test_emf_dump.py`、`test_export_pages.py`和`tools/check_m2.py --self-test`，全部不启动原版。

## 9. r4全约束明细

| 约束 | 原版断言 | 通过 | 自身未支持 | 祖先阻塞 |
|---:|---:|---:|---:|---:|
| 0 | 2715 | 2715 | 0 | 0 |
| 1 | 95 | 95 | 0 | 0 |
| 2 | 2509 | 2509 | 0 | 0 |
| 3 | 224 | 224 | 0 | 0 |
| 8 | 274 | 274 | 0 | 0 |
| 9 | 199 | 199 | 0 | 0 |
| 11 | 22 | 22 | 0 | 0 |
| 12 | 28 | 28 | 0 | 0 |
| 13 | 3 | 3 | 0 | 0 |
| 14 | 3 | 3 | 0 | 0 |
| 15 | 1663 | 1663 | 0 | 0 |
| 16 | 492 | 492 | 0 | 0 |
| 17 | 43 | 43 | 0 | 0 |
| 21 | 239 | 239 | 0 | 0 |
| 24 | 7 | 7 | 0 | 0 |
| 27 | 444 | 444 | 0 | 0 |
| 29 | 2 | 2 | 0 | 0 |
| 30 | 250 | 250 | 0 | 0 |
| 32 | 20 | 20 | 0 | 0 |
| 33 | 9 | 9 | 0 | 0 |
| 34 | 908 | 908 | 0 | 0 |
| 36 | 13 | 12 | 0 | 1 |
| 37 | 83 | 66 | 0 | 17 |
| 39 | 2 | 2 | 0 | 0 |
| 40 | 1 | 1 | 0 | 0 |
| 41 | 43 | 39 | 0 | 4 |
| 43 | 4 | 4 | 0 | 0 |
| 44 | 2 | 2 | 0 | 0 |
| 46 | 5 | 4 | 0 | 1 |
| 47 | 151 | 89 | 0 | 62 |
| 48 | 1288 | 816 | 3 | 469 |
| 52 | 125 | 125 | 0 | 0 |
| 54 | 1 | 1 | 0 | 0 |
| 58 | 2 | 2 | 0 | 0 |
| 65 | 137 | 74 | 0 | 63 |
| 66 | 148 | 105 | 0 | 43 |
| 69 | 29 | 29 | 0 | 0 |
| 75 | 135 | 135 | 0 | 0 |
| 79 | 6 | 6 | 0 | 0 |
| 80 | 56 | 56 | 0 | 0 |
| 81 | 12 | 12 | 0 | 0 |
| 82 | 6 | 6 | 0 | 0 |
| 86 | 226 | 30 | 0 | 196 |
| 94 | 163 | 107 | 19 | 37 |
