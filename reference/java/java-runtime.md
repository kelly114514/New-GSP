# JavaSketchpad 运行库静态逆向

目标：`C:\projects\逆向几何画板\sketchpad5\Support Files\jsp5.jar`。

**已恢复 143 个类的可读 Java 反编译代码，以及 28 个关键类/接口的 javap 字节码。确认对象依赖图、拖动传播、表达式求值和 HTML 构造文本解析入口。此 JAR 不是 GSP 二进制文件解析器；它主要是网页导出的交互运行库。** 本阶段没有启动 Applet、没有运行目标类、没有执行原生程序，也没有调用 REA 切换活动目标。

## 1. 证据与复现

| 项目 | 已核实值 |
|---|---|
| 原始 JAR 长度 | 178,032 字节 |
| 原始 JAR SHA-256 | `270e880a40309aee6c7704ca4aa4786d91032f18f176c50f58458988a88700da` |
| 归档内容 | 151 个 ZIP 条目；143 个 `.class`，其中 142 个在 `com/keypress/Gobjects/`，根目录为 `GSP.class` |
| Class 版本 | 全部 major=45、minor=3 |
| MANIFEST | `Created-By: 1.5.0_16 (Apple Inc.)` |
| 内部版本 | `Build._JavaSketchpadGrammarVersion=2`；开发版本 `5.0 Build 0970`；build 字串 `0970` |
| 反编译 | CFR 0.152；生成 143 个 `.java`；`summary.txt` 未列出失败类 |
| 原始字节码 | JDK 17 `javap -c -p -constants`，保存在 `analysis/java/bytecode/` |

工具来自 [CFR 官方页面](https://www.benf.org/other/cfr/) 的 `cfr-0.152.jar` 链接，下载到 `analysis/tools/`。其 MD5 为 `8a85ada8cec494121246805a5562b82b`，与页面公布值相同；SHA-256 为 `f686e8f3ded377d7bc87d216a90e9e9512df4156e75b06c655a16648ae8765b2`。执行的是反编译器，目标 JAR 作为数据输入，未执行其入口或静态初始化。

复现命令（PowerShell，工作目录 `C:\projects\逆向几何画板`）：

```powershell
& 'C:\tools\scoop\apps\temurin17-jdk\current\bin\java.exe' -jar 'analysis\tools\cfr-0.152.jar' 'sketchpad5\Support Files\jsp5.jar' --outputdir 'analysis\java\decompiled' --silent true
& 'C:\tools\scoop\apps\temurin17-jdk\current\bin\javap.exe' -classpath 'sketchpad5\Support Files\jsp5.jar' -c -p -constants com.keypress.Gobjects.Sketch
```

可读代码根目录为 `C:\projects\逆向几何画板\analysis\java\decompiled\`。下文源文件定位均相对该根目录；行号指本次 CFR 输出。反编译结果有自动生成变量、控制流与类型恢复，关键结论另用 javap 核对，不能冒充原厂源代码。

## 2. 入口与输入边界

### Applet → Sketch → Construction

`GSP.java` 的 `init()` 创建 `Sketch(this, new appletImageFetcher(this))`；`getSketchParameterValue(name)` 直接调用 Applet `getParameter(name)`。`Sketch.java:502–506` 构造时取得参数 **`Construction`**，然后 `startup()` → `InitObjects()` → `parseConstruction()`。

另一个入口是接口 `JSP_ExternIO.setConstruction(String)`，由 `Sketch.java:220` 更新字符串、重建全部对象、请求重绘并返回整数 **2**。外层 Applet `GSP.setConstruction()` 包装异常却固定返回 **0**，因此不能混淆两个返回值。

`parseConstruction()`（`Sketch.java:1028`）扫描分号数量分配对象数组，逐项识别文本关键字，构建对象，解析可选 `[...]` 外观属性，再要求 `;` 结尾。不是字节序列、TLV 或 GSP4/GSP5 记录读取。

`readObjectSpecifier(int numParents, int numDoubles, int numStrings)`（729 行）读取：

```text
(父对象引用..., 数值..., '字符串'...)
```

- 输入对象引用为 **1-based**，读入后减一作为 `GObjs[]` 下标。
- 固定项先读父引用，再读 double，再读单引号字符串；字符串中的单引号用连续两个单引号表示。
- `readVariableLengthSpecifier(boolean)`（695 行）读取括号内的变长引用列表。
- `eatWhiteSpace()`（637 行）跳过空格/换行/回车，支持 `{...}` 注释。
- 对象构造立即从 `GObjs[]` 取父对象；输入序列必须符合依赖先于子对象的预期。当前代码没有先建立全部空壳再解析任意前向引用的过程。

静态复原的最小示例（**未启动目标验证**）：

```text
Point(100,100)[label('A')];
Point(200,160)[label('B')];
Segment(1,2);
Midpoint(3)[label('M')];
```

这是网页构造文本示例，不是 `.gsp` 文件内容。`Point` 的 double 会显式转成 int；`Segment` 构造器接收两个父对象时参数顺序反转，此细节对射线方向和序列对照可能有价值。

### 实际文件读取范围

全库源码检查未发现 `FileInputStream`、`DataInputStream`、`ObjectInputStream`、`.gsp`/`GSP4`/`GSP5` 文件解码路径。几何输入来自上述字符串；图片用 `appletImageFetcher.getImageFromURL()`，取 Applet codebase 后调用 `Applet.getImage(codebase, name)`。这并不表示库完全没有网络功能，只能说明**本次检查到的几何加载入口不是原生文件读取器**。

## 3. 构造关键字与对象族

完整 `readMatch` 字面量及源行保存在 `analysis/java/specifiers.json`；其中包含子分支碎片，不能把条目数量直接当作对象类型数量。

| 文本关键字 | 固定参数/父引用（由调用代码核实） | 实现 |
|---|---|---|
| `Point(x,y)` | 0 父、2 数值 | `FreePoint` |
| `Point on object(parent,fraction)` | 1 父、1 数值 | 按父类型选圆/多边形/采样曲线/直线路径点 |
| `Segment(a,b)` / `Ray(a,b)` / `Line(a,b)` | 2 父 | `*Thru2Points` |
| `Midpoint(segment)` | 1 父 | `Midpoint` |
| `Circle(center,point)` / `Circle by radius(center,radiusObject)` | 2 父 | 两种圆构造 |
| `Intersect(a,b)` / `Intersect1(a,b)` / `Intersect2(a,b)` | 2 父 | 线线/线圆/圆圆交点；1/2 选择分支 |
| `Perpendicular` / `Parallel` / `Bisector` | 2/2/3 父 | 垂线/平行线/角平分线 |
| `Polygon(...)` | 变长父引用 | `PolygonByVertices` |
| `Reflection`、`Dilation*`、`Rotation*`、`Translation*` | 各自有固定/度量/标记等子形式 | 对象的 `createTransformedImage()` 与 `Transformer` |
| `Locus(trace,driver,path,n)` | 3 父、1 数值 | `Sampler.constructLocus(driver,path,trace,n)` |
| `Parameter(value,x,y,'name')` | 0 父、3 数值、1 字符串 | `Parameter` |
| `Calculate(x,y,'prefix','RPN')(parents...)` | 0 父、2 数值、2 字符串；后跟变长父引用 | `CompoundMeasure` + `parseList` |
| `Function(x,y,'prefix','RPN')(parents...)` | 同上 | `Function` + `parseList` |
| `FunctionPlot(function,coords,n,start,end,projection)` | 2 父、4 数值 | `FunctionPlot` |
| `Length` / `Angle` / `Area` / `Radius` / `Ratio*` / `Slope` / `Distance` | 结合父几何对象、显示坐标、名称 | `SimpleMeasure`，内部 measureType 为 1–15 |
| `ShowButton` / `HideButton` / `ToggleVisibilityButton` / `SimultaneousButton` | 坐标、名称 + 变长目标列表 | 动作按钮对象 |
| `Image` / `ImageOnPoint` / `ImageBetweenPoints` | 图片名称及位置/父点 | 图片对象与 codebase 加载 |

还包括坐标轴、单位点、原点单位坐标系、Coordinates/Abscissa/Ordinate、MoveButton/AnimateButton、FixedPoint/DriverPoint、PeggedText/ConcatText/FixedText、Spectrum/Grayscale/RGB/HSV 着色变换。

外观属性（`Sketch.java:856`）包括 hidden、基本颜色/color(R,G,B)、hairline/thin/mediumLine/thick、solid/dashed/dotted、dot/small/mediumPoint/large、layer、image、traced、label、auto、suffix、justify*、size/plain/bold/italic/font/digits。`thick` 还根据 `MinGrammarVersion` 选择旧版/新版线宽语义。

## 4. 对象依赖、更新和可见性

`GObject` 有明确的 `Parents[]`、`Children Vector`、`existing`、`hidden`、`traced` 字段。`AssignParent(index,parent)` 同时注册反向 child 边；`descendsFrom()` 递归查询祖先，缓存一次查询的祖先与布尔结果。`isVisible()` 是 `!hidden && existing`，几何不存在与用户隐藏是两个不同状态。

`Sketch.InitObjects()`（286 行）按构造顺序为每个可接受用户变化的对象预计算受影响后代列表：遍历后续对象，调用 `descendsFrom()`，再分配 `AffectedDescendents` 数组；逐对象 `Constrain(false)`，最后才按绘制顺序排序 `GObjs`。

```text
JSP_mouseDragged(x,y)
  → Draggable.dragTo(x,y,false)
  → 更新自由点/参数值
  → affected.constrainDescendents(false)
  → 每个后代依原构造顺序 Constrain(false)
  → paint(...)
```

具体证据：

- `MouseFreePoint.java:31–34`：写入 x/y 后调用 `affected.constrainDescendents`；对应字节码 `MouseFreePoint.javap.txt`。
- `AffectedDescendents.java:35–38`：循环调用每个对象的 `Constrain(boolean)`；`AffectedDescendents.javap.txt:78` 起可核对 invoke 指令。
- `Midpoint.java`：父对象是线段；`Constrain` 先检查父对象存在，再计算 `(x1+x2)/2`、`(y1+y2)/2`。`Midpoint.javap.txt` 两次 `ldc2_w 2.0` 和 `ddiv` 对应坐标平均值。
- `gStraightThrough2Points.Constrain`：从两个父点复制端点，更新斜率等二级约束。
- `LinearIntersection`：处理竖直线、平行斜率，再计算交点，最后调用双方 `includesPoint()`，使线段/射线的范围限制生效。
- `CircleCircleIntersection`：用圆心差、半径、判别式求两交点；同心或无实交点时令 `existing=false`；方向标志决定正负根。

这是**已由字节码支持的 Java 更新机制**，暂不能断言原生程序逐字采用同样算法或容器。

## 5. 表达式解析：后缀文本语法

`parseList.java:35` 的 `buildTokenList()` 将导出的表达式转为 token 数组；`evaluate()`（184 行）使用 **固定 40 个 double 的栈**，执行后缀/RPN 运算。token 数组长度按输入计算，所以 40 不是“表达式最多 40 个 token”，而是当前求值栈的容量。字节码 `parseList.javap.txt:592–593` 有 `bipush 40; newarray double`。

| 导出表达式 token | 含义 |
|---|---|
| `A` … `Z` | 依序引用当前计算对象的父 `SimpleMeasure`，使用其 value |
| `x` | 当前函数自变量 |
| `@fA` 等 | 调用对应父 `Function`，以栈顶作为自变量 |
| `#A0` 等 | 从父对象取方程成分；见 `equFormCompOp` |
| `+ - * / ^` | 弹出两个值运算；`^` 使用 `Math.pow` |
| `!` | 栈顶取负，与减法 token 不同 |
| `@sin_ @cos_ @abs_ @sqrt @ln__ @rond @trnc @acos @asin @atan @log_ @sgn_ @tan_` | 13 种内置函数，作用于栈顶 |

例如 `x x * ` 在静态语义上代表 x²；此阶段未用目标代码执行示例。`variableRef` 会拒绝 `isDefined=false` 的父测量值，求值结束为 NaN 会抛 `parseEvalFailure`，函数绘图还主动排除 Infinity。

**需要单独记录的差异候选：** `predefFunc.apply()` 的 `trnc`（常量 `trunc_Func=7`）分支实际调用 `Math.floor`。对应 `predefFunc.javap.txt:97` 是 `invokestatic java/lang/Math.floor:(D)D`，不是 CFR 猜测。它对负数的数学结果与使用手册 PDF 102 关于原生 `trunc(-1.3)=-1` 的说明不同。还未动态比较原生程序/网页导出，因此仅能把它列为语义兼容性检查点，不能直接判定原生函数有同一行为。

## 6. 轨迹、函数采样和外部控制

`Sampler.Constrain()` 会保存驱动点原坐标，沿 `Path` 逐样本移动驱动点，以 `locusDriving=true` 触发后代更新，记录被追踪对象，再恢复驱动点；使用 `evaluatingSelf` 与 `locusDriving` 避免采样递归。`constructLocus()` 仅针对 `gPoint` 和 `gStraight` 返回轨迹对象，其它对象返回 null 并输出“不支持”的说明。

`FunctionPlot` 在 `[domainStart,domainEnd]` 等间隔采样，最后一个样本明确取 domainEnd。projection=0/1/2/3 分别为 y=f(x)、x=f(y)、r=f(theta)、theta=f(r)；坐标转屏幕时纵向反号。没有从本类中看到通用符号代数求导器；名称 `Function` 不能据此推出原生创建导函数功能的实现。

`JSP_ExternIO` 接口提供 `getMeasurementObserver`、`getMeasurementData`、`pressActionButton`、`getActionButtonState`、`setParameterData`、`getExternIOItemList`、`setConstruction`。列表类别为 1=动作按钮、2=可观察测量、3=可设置参数。

测量按 prefix/名称查找，按钮按 label 查找；`SimpleMeasure.myObserver()` 延迟创建 `myObservable`，数值变更时调用 `setChanged()/notifyObservers()`。因此外部宿主可以观察数据并设置参数，不需把几何约束状态暴露成任意代码执行接口。

## 7. 与 GSP 二进制记录的关系

文件格式子任务的独立产物是 `C:\projects\逆向几何画板\analysis\gsp-format.md`、`gsp-structure.json`、`gsp-record-samples.json`。该任务发现 GSP 记录使用千位数量级的 kind，例如对象容器 **2000/2007**，以及 **2002** 的计数加 u32 向量。Java 库不直接读取这些记录，不能拿解析文本中的关键字序号当记录 kind。

Java `GObject` 的 **getGenera 大类常量为 0–9**：点 0、圆 1、直线型 2、图片 3、多边形 4、文本 5、动作 6、坐标系 7、Sampler 8、SamplerCurve 9。这与“记录 kind”属于不同层次；即便 GSP 对象头中某字段最终采用了类似编号，也必须单独证明。

一个有价值的结构对照候选是：文件格式任务的最小样本先有两个含 `<dd>` 坐标的对象，再有一个 kind2002 向量 `[count=2, 1, 2]` 的对象；前两对象头部候选 u16 为 0，第三为 2。这与 Java 中“两个点（genera=0）→两父直线型（genera=2）”、父引用 1-based 的结构一致。**这只是结构/语义一致性证据，尚未完成原生反序列化函数交叉验证，不能据此给全部字段命名或宣布枚举等价。**

该样本为 `sketchpad5/Samples/5.x实例/群师作品/技巧型案例/不显示方法之至尊.gsp`，2,208 字节，SHA-256 为 `53a4b5d8902ae4eb263377262739d46c6a18d6c60fe1acdd3fa7300ff83a4c3b`。本任务独立按偏移复读核实：kind2000 记录头在 `0x6E6/0x72A/0x79A`，各 payload 长 28；payload `0x6EE/0x732/0x7A2` 的首 u16 是 `0/0/2`；坐标 payload `0x712/0x782` 为 `(153,168)/(158,151)`；kind2002 的 payload `0x7C6` 是三个 u32le `2,1,2`。

建议后续同时保存同一个最小作品的 GSP 与 HTML/Java 导出，比较：

1. 每个对象头候选 type 是否对应 Java genera，还是另一个更细的构造枚举。
2. kind2002 向量是否稳定对应 HTML 的父引用列表，是否包含隐藏依赖/样式引用。
3. 点坐标是否为屏幕坐标，直线端点父引用顺序是否与 Java 导出反转规则一致。
4. 原生对象 `existing/hidden`、表达式 token、采样数量字段与网页表示是否有损失。

## 8. 产物索引与未解决项

- `analysis/java/decompiled/`：143 个可读 Java 文件；仅为逆向产物。
- `analysis/java/bytecode/`：关键入口/模型/求值/几何类的原始 javap 签名与字节码。
- `analysis/java/inventory.json`：JAR 与每个 class 的 SHA-256、长度、class 版本。
- `analysis/java/specifiers.json`：构造/平移/外观读取关键字及源行。
- `analysis/features-from-docs.md`：发布目录、帮助及工具资源的功能地图。

未完成：实际导出 HTML、原生/Java 数值一致性测试、GSP 对象类型与 Java genera 的完整映射、迭代/多页/声音/自定义工具的导出覆盖率。当前 JAR 的旧 Applet 运行方式及内部 5.0 build 也说明它不能代表 5.06 原生功能全貌。
