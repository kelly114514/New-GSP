/** 由菜单规格与命令注册表生成 docs/功能矩阵.md：每个规格命令的接入状态和验收用例。 */
import { writeFileSync } from 'node:fs';
import menuSpec from '../src/menu-spec.json';
import { commands } from '../src/commands';
import '../src/ui/menus';

interface Item { id?: number; name?: string; shortcut?: string; children?: Item[]; separator?: boolean }
const flat = (items: Item[], path: string[]): { item: Item; path: string[] }[] => items.flatMap(i => (i.separator ? [] : i.children ? [{ item: i, path }, ...flat(i.children, [...path, i.name ?? ''])] : [{ item: i, path }]));

const U = '单元测试', E = '浏览器交互测试', D = '桌面冒烟';
// 只按明确用例绑定证据，禁止按命令编号区间推断“原版互读”。
const EVIDENCE: Record<number, string> = {
  36868: '`e2e/app.e2e.ts`「保存再打开：新建图形保存成 .gsp 并读回」；`tests/save-integrity.test.ts`（保存保护）',
  36876: '`tests/scenes.test.ts`「刚撤消过：重做可用并带操作名；撤消按钮随撤消栈变化」（状态）',
  36877: '`tests/scenes.test.ts`「刚撤消过：重做可用并带操作名；撤消按钮随撤消栈变化」（状态）',
  36880: '`tests/scenes.test.ts`「已复制：粘贴可用；没有可粘贴的内容时灰」（状态）',
  36912: '`tests/scenes.test.ts`「有隐藏对象时“显示所有隐藏”可用；有追踪时“擦除追踪踪迹”可用，与选择无关」（状态）',
  36916: '`tests/scenes.test.ts`「有隐藏对象时“显示所有隐藏”可用；有追踪时“擦除追踪踪迹”可用，与选择无关」（状态）',
  36970: '`e2e/app.e2e.ts`「新建参数对话框：Shift+Ctrl+P 建立参数」',
  36975: '`e2e/app.e2e.ts`「参数计算与函数图像：新建函数 x^2 并绘制」',
  36976: '`e2e/app.e2e.ts`「参数计算与函数图像：新建函数 x^2 并绘制」',
};
function evidence(id: number): string { return EVIDENCE[id] ?? '逐项操作验收待绑定；注册不代表所有分支完成'; }
const NOTES: Record<number, string> = {
  36883: '创建动画按钮；可写入 .gsp',
  36884: '创建移动按钮；可写入 .gsp',
  36887: '创建链接按钮（跳页）；可写入 .gsp',
  36888: '创建滚动按钮；可写入 .gsp',
  36945: '平移：极坐标/直角坐标/标记向量/标记距离与角度；可写入 .gsp',
  36949: '迭代/深度迭代：原象为自由点、路径上的点、参数、计算结果；在画板里点击指定初象；多个映射；显示完整/最终迭代；可写入 .gsp。已实现迭代数据表；待实现：移动对象上的点到相对类似/随机位置',
  36946: '旋转：固定角度或标记角度',
  36947: '缩放：固定比或标记比',
  36964: '按住 Shift 为“横&纵坐标”；首次度量坐标自动建立坐标系',
  36969: '方程度量可写入 .gsp（直线 3 种、圆 5 种形式）',
  36972: '制表：距离度量列的表格可写入 .gsp，其它列存 .ngsp',
  36989: '绘制表中数据：把每行转成点',
  36977: '绘图函数已实现；手绘/图片函数已实现新版取样，须存 .ngsp；原版取样规则未核验',
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
