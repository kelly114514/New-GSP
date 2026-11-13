# 新版（0.1.0）

用 TypeScript + Canvas 2D + Tauri 2 实现的 Windows x64 动态几何软件。菜单、快捷键和鼠标操作沿用原版习惯，并能读写原版 `.gsp` 课件中的常用内容。**不使用“几何画板”“Geometer's Sketchpad”这两个名字；原版程序、PDF、采集截图和原始资源不在本目录，也不随软件发布。**

## 命令

```powershell
npm install
npm run dev                  # 浏览器里开发，http://127.0.0.1:5173
npm run build                # 类型检查 + 前端构建
npx vitest run               # 单元测试
npx playwright test          # 浏览器交互测试（需要本机 Chrome）
npm run scan -- ../sketchpad5 # 全库读取与求值扫描，可加 --decode-only 只扫描读取
npx tsx tools/bench.ts       # 性能基准
npx tsx tools/make-demo.ts demo   # 生成演示课件
npx tsx tools/make-matrix.ts      # 重新生成 docs/功能矩阵.md
npx tsx tools/roundtrip-audit.ts ../sketchpad5   # 全样例回写审计（读取→写出→读回，比较完整模型，另存不覆盖样例）
npx tsx tools/make-iter-interop.ts <输出.gsp>    # 迭代互读样本（再用原版另存、check-interop 比较）
npm run tauri -- build --bundles nsis                      # release 程序与安装包
npx tsx tools/survey-tools.ts  # 工具静态识别报告
npx tsx tools/desktop-tools-smoke.ts <new-gsp.exe>  # 本机工具整库桌面重放与保存读回
npx tsx tools/desktop-save-smoke.ts <new-gsp.exe>  # 本轮保存/启动冒烟（隔离恢复，不改剪贴板）
npx tsx tools/desktop-smoke.ts <new-gsp.exe> <样本.gsp>    # 真实 Tauri 窗口冒烟
npx tsx tools/installer-check.ts <安装包.exe> <样本.gsp>   # 安装→扫描→冒烟→卸载
```

原版互读（需要本机有原版程序，并遵守 `AGENTS.md` 的锁文件规则）：

```powershell
npx tsx tools/make-interop.ts <输出目录>
python ..\reference\raw\runtime\interop_roundtrip.py <输入.gsp> <另存.gsp>
npx tsx tools/check-interop.ts <输入.gsp> <另存.gsp>
```

## 目录

| 路径 | 内容 |
|---|---|
| `src/core` | 文档模型、几何、表达式、求值引擎、构造与变换、命中、存储与撤消 |
| `src/ui` | 画布绘制、文档窗口与交互、对话框、菜单、工具箱、多文档、打印 |
| `src/gsp` | `.gsp` 记录读取与读写编解码、新版课件 `.ngsp` |
| `src/commands.ts` | 命令注册表：菜单、快捷键、右键、工具按钮共用 |
| `src-tauri` | Tauri 外壳：原子保存、读文件、恢复快照、退出 |
| `tests`、`e2e` | 单元测试与浏览器交互测试 |
| `tools` | 扫描、互读、基准、桌面冒烟、安装包验收、演示课件、功能矩阵 |
| `docs` | 进度、功能矩阵、`.gsp` 格式、兼容性报告、测试报告、使用说明 |
| `demo` | 演示课件（`.ngsp` 完整；`.gsp` 几何页） |

文档入口：[进度](docs/进度.md)（含未完成项）、[兼容性报告](docs/兼容性报告.md)、[功能矩阵](docs/功能矩阵.md)、[使用说明](docs/使用说明.md)。

当前保存策略与审查整改见 [保存完整性修复](docs/保存完整性修复.md)。修改过的导入文件无法证明原格式信息完整保留时，会要求转存当前模型为 `.ngsp`；原文件保留。

本机原版工具库的载入、整库结果与原版互读证据见 [工具兼容验证](docs/工具兼容验证.md)。

阶段性格式、工具与原版互读证据见 [P1/P2实施与验收](docs/P1-P2实施记录.md)。最新测试和安装验收范围见 [测试报告](docs/测试报告.md)。
