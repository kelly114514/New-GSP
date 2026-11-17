/** 由菜单规格与命令注册表生成 docs/功能矩阵.md：每个规格命令的接入状态和验收用例。 */
import { writeFileSync } from 'node:fs';
import menuSpec from '../src/menu-spec.json';
import { commands } from '../src/commands';
import '../src/ui/menus';

interface Item { id?: number; name?: string; shortcut?: string; children?: Item[]; separator?: boolean }
const flat = (items: Item[], path: string[]): { item: Item; path: string[] }[] => items.flatMap(i => (i.separator ? [] : i.children ? [{ item: i, path }, ...flat(i.children, [...path, i.name ?? ''])] : [{ item: i, path }]));

const U = '单元测试', E = '浏览器交互测试', D = '桌面冒烟';
const commandCheck = '[原版与新版选中夹具实测](兼容性报告.md#第二十二轮)';
const transformCheck = '[原版与新版对话框夹具实测](原版差异审计.md#第二十四轮复核变换对话框)';
// 只按明确用例绑定证据，禁止按命令编号区间推断“原版互读”。
const EVIDENCE: Record<number, string> = {
  36868: '`e2e/app.e2e.ts`「保存再打开：新建图形保存成 .gsp 并读回」；`tests/save-integrity.test.ts`（保存保护）',
  36876: '`tests/scenes.test.ts`「刚撤消过：重做可用并带操作名；撤消按钮随撤消栈变化」（状态）',
  36877: '`tests/scenes.test.ts`「刚撤消过：重做可用并带操作名；撤消按钮随撤消栈变化」（状态）',
  36880: '`tests/scenes.test.ts`「已复制：粘贴可用；没有可粘贴的内容时灰」（状态）',
  36882: '`e2e/features.e2e.ts`「按钮：隐藏/显示按钮、链接按钮、动画按钮对话框；点击按钮执行」',
  36883: '`e2e/features.e2e.ts`「参数动画按钮：在界面填写离散变化和范围，点击执行并保存为原版格式」；原版属性页、定时采样及互读见兼容性报告第二十轮',
  36887: '`e2e/features.e2e.ts`「按钮：隐藏/显示按钮、链接按钮、动画按钮对话框；点击按钮执行」',
  36912: '`tests/scenes.test.ts`「有隐藏对象时“显示所有隐藏”可用；有追踪时“擦除追踪踪迹”可用，与选择无关」（状态）',
  36916: '`tests/scenes.test.ts`「有隐藏对象时“显示所有隐藏”可用；有追踪时“擦除追踪踪迹”可用，与选择无关」（状态）',
  36917: '`e2e/features.e2e.ts`「参数动画与路径点动画：开始、暂停，不修改构造定义；追踪留下痕迹」',
  36920: '`e2e/features.e2e.ts`「参数动画与路径点动画：开始、暂停，不修改构造定义；追踪留下痕迹」',
  36924: `${commandCheck}，线段、直线、圆、弧随机取点`,
  36925: `${commandCheck}，线段中点和重复构造`,
  36926: `${commandCheck}，直线交点、共用点、线圆交点`,
  36927: `${commandCheck}，三点闭合与反向复用`,
  36928: `${commandCheck}，三点按选择顺序构造`,
  36929: `${commandCheck}，三点闭合与反向复用`,
  36930: `${commandCheck}，过一点作平行线和重复构造`,
  36931: `${commandCheck}，过一点作垂线和重复构造`,
  36932: `${commandCheck}，三点构造及首尾对换`,
  36933: `${commandCheck}，圆心圆周点和重复构造`,
  36934: `${commandCheck}，线段为半径及重复构造`,
  36935: `${commandCheck}，圆上的弧和端点顺序`,
  36936: `${commandCheck}，三点弧、重复构造和端点顺序`,
  36937: `${commandCheck}，三角形、圆和弧的内部`,
  36939: `${transformCheck}，最后选中的点和取消其选中`,
  36941: `${transformCheck}，三点标记角及预选项`,
  36942: `${transformCheck}，无单位度量比值及预选项`,
  36943: `${transformCheck}，最后两个点的先后顺序与向量预选项`,
  36944: `${transformCheck}，标记长度与平移预选项`,
  36945: `${transformCheck}，水平、垂直、极坐标、标记向量及取消`,
  36946: `${transformCheck}，可见点中心、度与弧度、标记角及取消`,
  36947: `${transformCheck}，标记比、自动中心及取消`,
  36949: '`e2e/features.e2e.ts`「迭代：选两个点，面板里点画板指定初象…」「迭代：路径初象启用位置选项…」「深度迭代…」；原版路径初象夹具见兼容性报告第二十轮',
  36953: `${commandCheck}，线段长度`,
  36954: `${commandCheck}，两点及点到直线的距离`,
  36955: `${commandCheck}，三角形周长`,
  36956: `${commandCheck}，圆周长`,
  36957: `${commandCheck}，三点无向角`,
  36958: `${commandCheck}，三角形和圆面积`,
  36959: `${commandCheck}，弧度角`,
  36960: `${commandCheck}，弧长`,
  36961: `${commandCheck}，弧与圆半径`,
  36962: `${commandCheck}，两线段的比`,
  36963: `${commandCheck}，线段上点的值`,
  36964: `${commandCheck}，已有坐标系中的点坐标`,
  36965: `${commandCheck}，已有坐标系中的横坐标`,
  36966: `${commandCheck}，已有坐标系中的纵坐标`,
  36967: `${commandCheck}，两点坐标距离`,
  36968: `${commandCheck}，一条直线斜率`,
  36969: `${commandCheck}，直线及圆方程`,
  36970: '`e2e/app.e2e.ts`「新建参数对话框：Shift+Ctrl+P 建立参数」',
  36972: '`e2e/features.e2e.ts`「数据：新建参数、计算引用参数、制表、添加表中数据、绘制点」',
  36973: '`e2e/features.e2e.ts`「数据：新建参数、计算引用参数、制表、添加表中数据、绘制点」',
  36975: '`e2e/app.e2e.ts`「参数计算与函数图像：新建函数 x^2 并绘制」',
  36976: '`e2e/app.e2e.ts`「参数计算与函数图像：新建函数 x^2 并绘制」',
  36977: '`e2e/audit2.e2e.ts`「定义绘图函数对笔迹建立 f(x)」与 `e2e/media-math.e2e.ts` 的图片取样；两种新版笔迹在原版执行定义与绘制，见兼容性报告第二十一轮',
  36990: '`e2e/audit2.e2e.ts`「选中函数时“绘制函数”直接画图像」；原版执行笔迹函数绘制及图像互读见兼容性报告第二十一轮',
};
function evidence(id: number): string { return EVIDENCE[id] ?? '逐项操作验收待绑定；注册不代表所有分支完成'; }
const NOTES: Record<number, string> = {
  36883: '创建动画按钮；可写入 .gsp',
  36884: '创建移动按钮；可写入 .gsp',
  36887: '创建链接按钮（跳页）；可写入 .gsp',
  36888: '创建滚动按钮；可写入 .gsp',
  36945: '平移：极坐标/直角坐标/标记向量/标记距离与角度；可写入 .gsp',
  36949: '迭代及深度迭代支持多个映射、完整或最终迭代、数据表和两项路径点位置模式，可写入 .gsp',
  36946: '旋转：固定角度或标记角度',
  36947: '缩放：固定比或标记比',
  36964: '按住 Shift 为“横&纵坐标”；首次度量坐标自动建立坐标系',
  36969: '方程度量可写入 .gsp（直线 3 种、圆 5 种形式）',
  36972: '制表：已互读无单位、厘米和度数混合列；原版打开时重算末行，无法保留的表格转存 .ngsp',
  36989: '绘制表中数据：把每行转成点',
  36977: '新版标记工具的透明位图与绘图函数可写入 .gsp；旧折线笔迹使用 .ngsp',
  36908: '按参数着色：色调/灰度；范围与循环方式可选；.gsp 暂不能保存',
};

const rows: string[] = [];
let implemented = 0, deferred = 0;
for (const menu of menuSpec as { name: string; items: Item[] }[]) {
  for (const { item, path } of flat(menu.items, [menu.name])) {
    if (item.id === undefined || item.id < 0) continue;
    const d = commands.get(item.id);
    if (!d) continue;
    const status = d.deferred ? `**本版暂缓**（${d.deferred}）` : '已接入';
    d.deferred ? deferred++ : implemented++;
    rows.push(`| ${path.join(' → ')} | ${item.name}${item.shortcut ? `（${item.shortcut}）` : ''} | ${item.id} | ${status} | ${d.deferred ? '菜单位置保留，命令禁用，提示“本版暂缓”' : evidence(item.id)}${NOTES[item.id] ? `；${NOTES[item.id]}` : ''} |`);
  }
}

const md = `# 功能矩阵

由 \`tools/make-matrix.ts\` 依据菜单规格（\`reference/spec/menus.json\` 生成的 \`src/menu-spec.json\`）和命令注册表（\`src/commands.ts\`）自动生成；\`tests/matrix.test.ts\` 保证规格里的每个命令都有映射。

- 命令注册并接入 **${implemented}** 项，注册表标为暂缓 **${deferred}** 项。这只表示入口接线，不是功能完成率；脚本视图、非注册控件、内部未完成分支及保存限制另见说明和 \`docs/进度.md\`。
- 网页导出与原版在线入口不在新版范围。
- 命令证据按明确用例逐项绑定；未绑定的标为待验收。状态断言不等于操作验收，浏览器回归不等于桌面验收。原版互读证据只在 \`docs/兼容性报告.md\` 的具体样本中报告，不从编号推断。
- 所有“可写入.gsp”只表示存在对象编码路径，文档仍须通过保存完整性检查。
- 非菜单表中的测试类型表示仓库已有相关回归，详细边界见 \`docs/测试报告.md\`；不代表所有原版场景均已验证。

## 工具与交互（非菜单）

| 功能 | 状态 | 验收用例 |
|---|---|---|
| 工具箱 9 组、长按弹出条（1 秒）、子工具记忆、自定义工具菜单（创建/使用/工具文件夹/文档内嵌工具） | 部分实现（见 docs/工具兼容报告.md；有只读脚本视图与显式唯一匹配；原版工具调用一致性未完成） | 浏览器交互测试 |
| 移动/旋转/缩放箭头、点、圆、线段/射线/直线、多边形三种、文本、标记、信息 | 已实现 | 浏览器交互测试 |
| 命中半径三档、点优先、相交处单击生成交点、累加/取消/Shift 空白、框选（相交）、拖动语义 | 已实现 | ${U}、${E} |
| 端点吸附 10 px、线上松开得依附点、整线段平移、圆心/圆上点不同拖动 | 已实现 | ${E} |
| 标签：第一次显示按选择顺序分配、不回收、A₁… | 已实现 | ${U}、${E} |
| Tab 轮换、Esc 取消、右键菜单（按对象类型）、文本工具栏 | 已实现 | ${E} |
| 撤消/重做（一次拖动一个事务，取消不残留） | 已实现 | ${U}、${E} |
| 路径点动画、参数动画、移动按钮、追踪、擦除追踪、运动控制台；暂停不修改构造定义 | 已实现 | ${E} |
| 多文档、平铺/层叠、多页（增加/复制/切换/改名/删除）、页链接按钮 | 已实现 | ${E}、${D} |
| 页面设置、打印预览、系统打印 | 已实现（系统打印对话框无法自动化，仅验证预览） | ${D} |
| 文本编辑（中文输入走系统输入法的 textarea）、图片粘贴、图片裁剪到多边形 | 已实现 | ${E} |
| 未保存关闭提示、最近文件、设置持久化、崩溃恢复快照 | 已实现 | ${D}、${E} |

## 命令

| 菜单 | 命令 | ID | 状态 | 验收用例 / 说明 |
|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync('docs/功能矩阵.md', md);
console.log(`功能矩阵：已接入 ${implemented}，注册暂缓 ${deferred}`);
