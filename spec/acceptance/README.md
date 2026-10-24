# 几何验收协议 v1

本目录只放必要的衍生几何数据，不放第三方 `.gsp`、HTML、EMF 或它们的完整构造文本。`samples/baseline/` 是本项目用原版新建的基准输入。第三方语料按输入相对路径和 SHA-256 在本机定位。

## M2 求值输出接口

实现方提供 Node 命令，读取 `.gsp` 并输出以下 JSON（或由本方 adapter 将公开 core API 转成此格式）。索引是 **1 起的页次序和页内 2000 对象次序**，不是标签、绘制次序或 HTML 步骤号。坐标是存档中的 96 dpi 文档像素，y 向下，不能套用 EMF 页边距或截图坐标。

```json
{
  "schema": "gsp-core-geometry-v1",
  "pages": [{
    "pageIndex": 1,
    "objects": [
      {"objectIndex": 1, "exists": true, "kind": "point", "geometry": {"x": 211, "y": 147}},
      {"objectIndex": 3, "exists": true, "kind": "segment", "geometry": {"a": [411,281], "b": [211,147]}}
    ]
  }]
}
```

`kind` 与 `geometry` 的字段：

| kind | geometry | 比较方式 |
|---|---|---|
| point | `{x,y}` | 欧氏距离 |
| segment | `{a:[x,y],b:[x,y]}` | 两端点；允许颠倒 |
| line | `{a:[x,y],b:[x,y]}` | 两个不同点定义的无限直线；比较 EMF 可见线段两端到直线的距离 |
| ray | `{a:[x,y],b:[x,y]}` | a 是起点，b 定义方向；比较射线与 EMF 可见部分 |
| circle / disk | `{center:[x,y],radius}` | 中心和半径 |
| polygon | `{vertices:[[x,y],...]}` | 顶点；允许循环换起点与反序 |
| arc | `{center:[x,y], radius, startAngle, sweepAngle, start?:[x,y], end?:[x,y]}` | 圆心、半径、弧覆盖的区间（见下）；`start`/`end` 可选 |
| sector | 同 arc | 扇形内部（约束 82）：圆心、半径和父弧覆盖的区间 |
| circular-segment | 同 arc | 弓形内部（约束 83）：圆心、半径和父弧覆盖的区间（弦隐含） |

**弧类字段约定。** `startAngle`、`sweepAngle` 是弧度，数学角：`angle = atan2(−dy, dx)`（页面坐标 y 向下），页面点是 `center + radius·(cos a, −sin a)`；`sweepAngle>0` 表示页面上看起来逆时针，带符号，`|sweepAngle|` 在 (0, 2π) 内（整圆与零弧的表示〔未知〕，比较器把 `≥359.999°` 当作整圆）。`startAngle` 是弧**第一端点**（A）的角，`sweepAngle` 从第一端点扫到第二端点（79/80 恒为正，81 可正可负）。可选的 `start`、`end` 是两端点的页面坐标。比较器（`check_m2.py`）把预期与实际都归一成「逆时针覆盖区间 [lo, hi]」，比较圆心、半径、区间两端点和**区间中点**（中点把一条弧与它的补弧区分开，两个半圆的端点相同但中点相反），所以实现输出 `sweepAngle` 为负的等价描述也会通过；方向写反（取了补弧）会失败。`start`/`end` 若提供，必须是区间的两端点（顺序不限）。预期值由原版 EMF 图元归一成 `sweepAngle>0` 的逆时针区间（原版的 `DrawArc`/`FillPie` 起始角是页面顺时针为正，已转换）。弓形在原版里是只含弧的填充路径（隐式闭合），预期的 `center/radius/区间` 由路径首段端点的法线精确求出。退化的 81（共线或超大半径）若实现按线段输出，`kind` 取 `segment`，可附 `degenerateArc`、`parameterizationKnown` 标志，比较器忽略这两个标志；原版对该分支的实际行为〔未知〕，目前没有预期值。

变换像（约束 16–34、75 中经数值验证的类型，见 [对象卡片](../objects/cards/README.md) 通用契约）沿用源几何的 kind（点像是 `point`，线段像是 `segment`，圆像是 `circle`，弧像是 `arc`，多边形像是 `polygon`，内部像是 `disk` / `sector` / `circular-segment`）。可见性判据：对象头状态码 0 为可见，1–4 在原版导出里一律是隐藏（13,132 个与 HTML 绑定的对象无例外），隐藏对象没有 EMF 期望。

其它 M2 类型在对象卡片和测量器形成独立证据后扩展；不能用尚无 oracle 期望的类型算作通过。`exists:false` 的对象可以没有 geometry；不允许用 NaN/Infinity 充当坐标。隐藏对象仍应求值，但 EMF 本身没有隐藏对象的几何，只有有独立证据的隐藏对象才有断言。

拖动输出使用相同协议：先将指定自由点改到目标坐标，重新求值后输出。基准拖动操作是 `midpoint.gsp` 页 1 对象 1 从 `(211,147)` 到 `(251,174)`；期望来自原版 `midpoint-moved.gsp` 的独立 EMF。被拖点、线段、中点全部比较。

## 期望和证据

每个用例格式为 `gsp-m2-oracle-case-v1`，包括 `source:{path,sha256}`、`pageIndex`、`assertions`、`excluded`、`coverage` 和 `oracle` 元数据。断言包含 `objectIndex`、`constraint`、`kind`、`geometry`、`tolerancePx` 与 `provenance`。provenance 必须说明来源是原版 EMF 图元、HTML 的直接 Point 参数或本项目基准 UI，提供原始输出的 SHA-256、图元序号和唯一匹配方式。

坐标预估只能用于寻找唯一的原版图元，断言数值必须从匹配后的 EMF 量得；预估不能直接成为期望。未匹配、重复/重合歧义、隐藏对象、非活动页、裁剪导致无法量测、HTML 不支持的类型或依赖未覆盖，都逐条写入 excluded 并计入分母。

HTML 的 Point 坐标也可能整体平移，必须独立拟合到存档坐标；HTML 的构造实参次序可能与原生 2002 顺序不同。**文本反序不表示原生路径点方向反序**；匹配器预测遵守经独立 EMF 核对的原生参数定义，不从 HTML 文本次序臆定方向。HTML 此处仅提供构造拓扑、参数和隐藏属性以协助身份匹配。

导出只有打开后的当前页。页次序取存档 900 头活动页；多页文件不会被报告为全文件显示通过。EMF 是 600 dpi 双格式，测量使用 `emf_dump.py` 的 auto 层（EMF+ 加 GetDC 后生效 GDI），禁止把镜像 GDI 再计一次。先换算到 96 dpi，再由自由点与原版图元的唯一对应求平移；不能套用固定页边距公式。HTML 步骤号不当成原生对象号。

几何默认容差为 0.1 文档像素（大于 EMF 解码 0.001 像素的舍入误差）；只适用于图元量测。样式来源保留在 provenance 的 EMF pen/brush 字段：颜色、线宽、填充状态；标签文本和完整渲染验收仍单独列为未覆盖，不能由几何测试推出样式/标签通过。

可复跑命令、覆盖数字与限制写在 [m2/README.md](m2/README.md)。实现方只需读取本目录及对象卡片；不需要读取 oracle、tools、reference、re 或原版二进制。
