# 实现方提出的规格空白

格式：问题 / 需要什么 / 卡住了哪个功能。规格方回答后移到对应规格里。

**2026-10-24原版实验补充：** Q6里79/80离圆边界已补非对称原版导出证据；79不能一概使用父圆半径。81已观察线段退化，但精确阈值、弦外存在性、路径单位仍未定。example-46零扫角显示上不画整圆，存在性未知。见79–81卡片和`spec/acceptance/m4-batch1.md`。本轮产品仍保留这些边界的未支持状态，避免把新证据扩大成未经验证的后代规则。

Q1–Q3 的答复已移入 [格式规格 §6.1.1、§5.9](format/gsp-format.md)：

- Q1：暂无可靠 GBK/Big5 自动检测依据；保留显式编码选择。原版旧布局全局覆盖的来源和初值仍待查（§12.7）。
- Q2：结构布局与编码 ID 分开；按已知 ID 解码，跨布局组合报告诊断，未知 ID 保留字节并提示未支持。完整代码页表和矛盾组合原版行为仍待验证。
- Q3：确认全部类型 902 都校验共同的三提示串结构；未知内容类型不能绕过信封边界校验。

这些是规格答复，不表示读取器已经修改。特别是 Q2 的“按编码 ID 解码并报告异常布局组合”需由实现方后续落实；当前 M1 读取器仍按布局选择 UTF-8/ANSI 时，应明确保留这项实现差距。

## Q4（M2 render）：完整样式、可见性和标签布局仍缺独立契约

- 问题：当前卡片只确认 RGB、样式拆位和标签文字；status 0..4、w0/w1/w2 的完整语义、2005 标签显示开关与偏移、1203 字体/文本样式仍未定。多边形自交填充及区域边框字段也未定。
- 需要：由原版实验或明确静态证据给出每个字段的映射，区分几何存在、隐藏、标签隐藏；给出点直径/描边、线宽/线型、填充规则、标签定位与字体回退规则。
- 现状：core 始终求值隐藏状态未知的对象；render 保留原值并用 viewer 默认外观，只按已确认 RGB 着色，不制造自动标签。现有标签仅显示已保存的文字。默认外观不计作原版样式/标签验收通过；本批独立几何 oracle 也明确不验收样式。
- 卡住：完整样式和标签验收。几何与自由点拖动不阻塞。

## Q5（M2 core）：退化线段、零半径圆和零面积多边形的存在性

- 问题：卡片明确保留 A=B 线段、r=0 圆及零面积多边形的原版边界行为；尤其退化线段的中点是否仍存在不能由数学推断冒充原版验证。
- 需要：原版构造/拖动到上述边界并恢复的期望存在性；若存在，给出几何和命中/显示策略。
- 现状：退化线段和零半径圆返回 unsupported + 稳定原因，后代传播该状态；多边形仍保留所有重复顶点、父序和几何，不删除零长度边。正常输入按卡片求值。
- 卡住：退化边界的完整兼容验收；正常基准几何和拖动不阻塞。

## Q6（M2 core）：弧、扇形、弓形的交换格式，及弧相关的未验证边界

实现方在 `geometry-dump.ts` 输出里为弧与弧内部加了字段。验收协议 [acceptance/README.md](acceptance/README.md) 的 kind 表还没有这些类型，请规格方（W2 的比较器）对齐，或告诉我要改成什么。

**交换格式（`gsp-core-geometry-v1` 的扩展）：**

| kind | geometry | 说明 |
|---|---|---|
| `arc` | `{center:[x,y], radius, startAngle, sweepAngle, start:[x,y], end:[x,y]}` | 约束 79/80/81 |
| `sector` | 同上 | 约束 82，父弧加两条半径闭合 |
| `circular-segment` | 同上 | 约束 83，父弧加弦闭合 |
| `segment`（带 `degenerateArc:true`） | `{a,b}` | 约束 81 的共线/半径超过 30,000 的线段分支；`parameterizationKnown:false` |

- `startAngle`、`sweepAngle` 是**数学角**（弧度）：`angle = atan2(−dy, dx)`，页面点 `center + radius·(cos a, −sin a)`；`sweepAngle > 0` 表示在页面上看起来逆时针，符号带方向，|sweepAngle| 在 (0, 2π) 内。
- `start`、`end` 是弧端点的页面坐标，由角度推出。**建议比较器比较 `start`/`end`/`center`/`radius` 和经过的一侧（例如弧中点），不要直接比角度**：方向约定是〔静态证据〕，原版若证明相反，只改内核里一个常量（`impl/packages/core/src/arc.ts` 的 `ARC_ORIENTATION`），端点会随之互换，而比较器不用改。
- 弧中点可由 `center + radius·(cos, −sin)(startAngle + sweepAngle/2)` 得到。

**内核返回 `unsupported` / 不存在的弧相关边界（都需要原版实验或更多静态证据）：**

| 约束 | 条件 | 当前结果 |
|---|---|---|
| 79 | A 或 B 不在圆周上（相对容差 1e-6） | `unsupported: arc-endpoint-off-circle-unverified` |
| 79 | A=B（整圆还是零弧） | `unsupported: arc-coincident-endpoints-unverified` |
| 80 | O=A 或 O=B | `not-existing: arc-center-coincides-with-direction-point`（卡片说“无定义”） |
| 80 | |OA|≠|OB| | `unsupported: arc-unequal-radii-unverified` |
| 80 | A、B 同方向 | `unsupported: arc-coincident-directions-unverified` |
| 81 | A=B | `not-existing: coincident-arc-endpoints` |
| 81 | 共线或半径/圆心坐标超过 30,000，M 在弦内（沿 A→B 的投影严格在 0 与 1 之间） | 线段 A→B，`degenerateArc:true` |
| 81 | 同上但 M 在弦外 | `unsupported: three-point-arc-degenerate-middle-outside-chord-unverified` |
| 82/83 | 父是 81 的线段退化分支 | `unsupported: arc-interior-of-degenerate-arc-unverified` |
| 15 | 多边形参数 s 不在 [0,1]（边比例） | `unsupported: native-polygon-parameter-out-of-range-unverified` |
| 15 | 多边形边序号 ≥ 顶点数 | `unsupported: native-polygon-edge-index-out-of-range` |
| 15 | 81 的线段退化分支作为路径 | `unsupported: path-direction-and-unit-unverified` |
| 11/12 | 弧父有两个合法候选（线在弧范围内的两个根） | `unsupported: intersection-arc-root-order-unverified` |
| 13/14 | 弧父有两个合法候选 | `unsupported: intersection-arc-root-order-unverified` |
| 13/14 | 圆与 81 的线段退化分支有两个合法候选 | `unsupported: intersection-degenerate-arc-root-order-unverified` |

只有一个合法候选时（另一个落在线段/射线范围或弧范围之外），11/12、13/14 返回这一点，两个 ID 结果相同；这与卡片“只有一个合法候选时两 ID 可能得到同一点”一致。

- 问题：弧父的两个合法候选时 11/12、13/14 各取哪一个（卡片只说“方向符号参与选择”，没给公式）；81 共线时 M 在弦外是否有效；79 的 A/B 偏离圆周时是投影还是不存在；多边形上 s 超出 [0,1] 的含义。
- 需要：原版对这些边界的实验结果，或 EMF/拖动证据。
- 卡住：弧相关交点在“两个合法候选”状态下的验收；其余正常几何不阻塞。

**规格方答复（Q6 的交换格式部分，2026-10-24）：**

- 交换格式已按本条采纳，写入 [acceptance/README.md](acceptance/README.md)：`kind` 取 `arc`、`sector`、`circular-segment`，字段 `center`、`radius`、`startAngle`、`sweepAngle`（弧度，数学角，`sweepAngle>0` 为页面上看起来逆时针，带符号）和可选 `start`/`end`；退化的 81 若按线段输出，`kind` 取 `segment`，可附 `degenerateArc`、`parameterizationKnown`，比较器忽略这两个标志。`tools/check_m2.py` 的比较器按「逆时针覆盖区间」比较圆心、半径、区间两端点和区间中点，因此 `sweepAngle` 的符号写法不限，取成补弧（方向写反）会失败。期望值来自原版 EMF 弧/扇形/弓形图元，已归一成 `sweepAngle>0`。
- 弧的方向约定已由原版 EMF 验证，不再是静态证据：79/80/81 都是页面上看起来逆时针从第一端点 A 到第二端点 B（81 是经过 M 的那一段，可顺可逆），见 [79.md](objects/cards/79.md)–[81.md](objects/cards/81.md)。实现里 `ARC_ORIENTATION` 常量不必改。
- 仍然〔未知〕、语料保存状态里**从未出现**、只有拖动才会出现的情形：80 的 |OA|≠|OB|（语料 506 个可求对象最大偏差 4.7e−12 px）、79 的 A/B 偏离圆周（223 个对象最大 1.2e−5 px）、81 共线/半径超过 30,000（183 个对象最大半径 9,162）、A=B 同方向、弧交点在「两个合法候选」时的选择（13 个弧父交点对象里每次都只有一个根在弧上）。实现保持当前的 `unsupported` 处理是对的；要确定这些，需要用户同意的原版实验，建议见各卡片的「建议原版实验」。
- 已验证、可以去掉 `unsupported` 的：15 在多边形上的 `s∈[0,1]`（46 个可见点）；15 在弧上按 `t·sweepAngle` 从 A 起算（55 个可见点）；11/12/13/14 弧父的回退规则（首选根不在弧上时取另一个，10 个对象）。多边形 `s` 超出 [0,1] 的含义〔未知〕，保持现状。

## Q7（M4 第一批）：零比例与非共线三点比的边界

- 问题：30/32 的比例为 0 时，点、线、圆与区域是否都存在，塌缩像是否可作为路径、镜面或圆的半径来源？32 的 D、E、F 不共线时使用距离比还是沿 DE 的投影比？卡片明确这些尚未验证。
- 需要：原版构造、拖动到边界并恢复的独立结果，至少覆盖点、线段、圆、弧，以及其上的 15 路径点；非共线三点应给出能区分距离比与投影比的数值。
- 现状：30/32 的零比例返回 `unsupported: zero-scale-existence-unverified`；32 非共线返回 `unsupported: three-point-ratio-noncollinear-unverified`。分母 DE=0 返回 `not-existing: zero-ratio-denominator`，恢复祖先后重算。正常有向比例、负比例与链式变换已实现。
- 卡住：上述未验证边界的兼容验收；第一批正常输入不阻塞。75 依卡片仅求源几何并使用对象头最近颜色，数值颜色父的求值仍留待度量实现；22 依卡片保留原记录，尚不纳入本批九类变换。
