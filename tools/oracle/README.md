# oracle：驱动原版几何画板 5 导出对照输出

`gsp_oracle.py` 打开 `.gsp`，让**原版** `GSP5chs.exe`（5.06 中文版）把当前页另存为 **EMF** 和 **HTML（JavaSketchpad 构造描述）**，再关闭文档，并为每个文件写一行 `manifest.jsonl`。
`tools/emf_dump.py` 把 EMF 解成图元列表，作为几何验收的比较对象。

**启动须经用户同意。** 每次运行只启动一次原版；进程退出、超时或会话不可安全恢复时记录断点并停止，不自动重启。2026-10-23 本轮续跑已获用户授权。下文第 6 节的自动重启故障注入是旧版的历史测试，不代表当前策略。

原版是用户自己的授权副本。程序只从 `oracle/runtime/` 的副本运行（启动前校验 SHA-256 `bf22c098…c7b3`）；输入 `.gsp` 先复制到 `oracle/work/in/` 再打开，原件不会被改动。

> 注意：`.gitignore` 用 `/oracle/`（带前导斜杠）只忽略本机导出目录，`tools/oracle/` 照常入库。改成不带斜杠的 `oracle/` 会把本目录一起忽略。

## 1. 环境

只在 Windows、有交互桌面的会话里能跑（原版是 GUI 程序，窗口会出现在任务栏，默认最小化、不抢焦点）。

```powershell
cd C:\projects\GSP-plus
python -m venv tools\oracle\.venv
tools\oracle\.venv\Scripts\python.exe -m pip install -r tools\oracle\requirements.txt   # pywin32 (+ 可选 Pillow)
tools\oracle\.venv\Scripts\python.exe tools\oracle\gsp_oracle.py setup                  # 复制 exe 和 Support Files 到 oracle\runtime 并校验哈希
```

- 依赖只有 `pywin32`；`Pillow` 只用于失败时截图（`--screenshots`）。没有用 pywinauto / UI Automation：原版是 32 位 MFC 程序，64 位 Python 的 pywinauto 在跨位数读控件上有限制，纯消息自动化更稳。
- `oracle/work` 路径必须是 ASCII（原版文件对话框是 ANSI 的，路径经 GBK 转码）。
- 同一时刻只能有一个 `gsp_oracle` 在跑（`oracle/state/oracle.lock`，它们共用一个原版实例）。
- 脚本只操作、关闭本轮自己启动的 `GSP5chs.exe`。若 `oracle/state/pid.json` 指向仍在运行的旧原版进程，本轮报错停止，不接管或结束它。不碰其它程序，也不发送键盘/鼠标输入。

## 2. 用法

```powershell
$py = "tools\oracle\.venv\Scripts\python.exe"

# 单个文件（不写 --emf/--html 则两者都导）
& $py tools\oracle\gsp_oracle.py export --in samples\baseline\samples\segment.gsp --out-dir oracle\out1 --emf --html

# 批量：清单是 .txt（每行一个路径或 glob，# 开头为注释）或直接给 glob
& $py tools\oracle\gsp_oracle.py batch --list tools\oracle\validation-30.txt --out-dir oracle\validation
& $py tools\oracle\gsp_oracle.py batch --list "original/sketchpad5/Samples/**/*.gsp" --out-dir oracle\full --resume --timeout 120

# 排障：列出菜单、保存类型、窗口
& $py tools\oracle\gsp_oracle.py probe

# 看 EMF
python tools\emf_dump.py oracle\validation\samples\baseline\samples\segment.emf             # 头 + 逐条记录 + 图元
python tools\emf_dump.py X.emf --primitives                                                  # 只要图元摘要
python tools\emf_dump.py X.emf --json X.json                                                 # 完整 JSON
python tools\emf_dump.py X.emf --digest                                                      # 图元级规范化 SHA-256
python tools\oracle\test_emf_dump.py                                                         # 解析器自测（现场用 GDI 画一个 EMF 再核对）
```

常用选项：`--timeout S` 单文件总超时（默认 90）；`--retries N` 仅在原版干净拒绝文件、会话仍安全时重试（默认 0）；`--resume` 跳过 manifest 里已成功且输出还在、输入哈希未变的文件（原版明确不生成 EMF 的空页也能跳过），失败/超时的会列入本轮（`--skip-failed` 连它们也跳过）；`--max-files N` 本轮最多处理 N 个文件后停止（默认 0，不限制；旧选项 `--recycle` 是此选项的别名，不再重启）；`--show min|normal`（见第 5 节，**默认最小化，请勿随意改**）；`--screenshots` 失败时存窗口截图到 `<out-dir>/_fail/`；`--keep-work-files` 保留 `oracle/work/in/` 的临时输入副本（见下）。

**`--keep-work-files` 用在删除受限的环境**：每个文件处理完会删掉 `work/in` 的输入副本，长批次累计上千次删除。宿主要是按每条命令/每轮给删除配额（运行时报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`），批次会在约第 45–50 个文件处被强制中断。开启本选项后 `work/in` 的副本不删（同名文件后写覆盖前写，不影响结果），本轮跑完手动清一次即可。`work/out` 的清空保留，因为要靠它判断原版是否真的写出了文件。

输出目录镜像输入的相对路径（相对仓库根，或 `--root`）：`<out-dir>/<相对目录>/<主名>.emf|.htm`，另有 `manifest.jsonl`。

### manifest.jsonl 一行的字段

`input`（相对路径）、`input_size`、`input_sha256`、`started`、`doc_title`、`window_title`、`main_iconic`、`outputs`（`emf`/`html` 各含 `path/size/sha256/valid`；EMF 另有 `n_records/has_emfplus/draw_records/frame_mm/canon_sha256`；HTML 另有 `construction_steps/canvas`；原版没写出文件时为 `{"produced": false}`）、`dialogs`（见下）、`stage_seconds`（open/emf/html/close）、`status`（`ok`/`failed`/`timeout`）、`error`、`seconds`、`attempts`、`notes`、`restarted`、`screenshot`、`busy_after_open`。

`canon_sha256` 是图元级规范化摘要：EMF **字节**每次导出都会不同（EMF+ 对象槽位号、LOGFONT 填充字节是栈残留），所以比较两次导出请用 `canon_sha256` 或 `emf_dump.py --digest`，不要比文件哈希。

## 3. 工作方式与弹窗处理

文件(F)菜单里的命令直接 `PostMessage(WM_COMMAND, 命令ID)` 发给主窗口 `GSP5MainWin`：打开 `0x9001`、另存为 `0x9005`、关闭 `0x9006`、停止动画 `0x9038`（无文档时打开是 `0xE101`）。打开/另存为都是标准 Win32 通用对话框（`#32770`，经典风格），直接对控件发消息：文件名 Edit（ID 1148，用 `WM_SETTEXT`，用 `WM_GETTEXT` 读回校验）、保存类型 ComboBox（ID 1136，`CB_SETCURSEL` + `CBN_SELCHANGE`）、`IDOK`。

“另存为”的保存类型列表（运行时核对）：0 `几何画板文档(*.gsp)`，1 `GSP4文档(兼容版本)(*.gsp)`，2 `HTML/Java 几何画板文档(*.htm)`，3 `增强型图元文件(*.emf)`。“打开”的类型：`几何画板文档(*.gsp;*.gs4)`、`所有文件(*.*)`。

**HTML 导出**不需要按 Shift：直接在另存为里选类型 2。实测按住 Shift 再发“另存为”命令（真实 Shift 按下 + 窗口在前台），得到的只是同一个对话框、**预选了类型 2**，选完保存后文件逐字节相同，没有额外弹窗。手册说的“同时复制 jsp5.jar”在两种路径下都**没有**发生（输出目录里只有 `.htm`）；原版 `Support Files\jsp5.jar` 在位也一样。需要 jar 就自己复制。

每个文件的流程：清点 MDI 子窗口数 → 打开 → 等新文档窗口出现、进程 CPU 空闲 → 另存 EMF → 另存 HTML → 关闭文档 → 文档数回到基线。导出先写到 `oracle/work/out/<主名>.emf|.htm` 再移到目标位置（路径 ASCII；**HTML 的 `<TITLE>` 和页脚取自保存的文件名，所以临时文件和输入同名**）。

遇到的弹窗全部写进 manifest 的 `dialogs`（`stage/title/text/buttons/action/t`），处理规则：

| 弹窗（标题 | 文字） | 出现时机 | 按钮 | 处理 |
|---|---|---|---|---|
| `几何画板` \| `要保存更改到 <路径> 吗？` | 关闭文档（如 `Sample.gsp`，载入后文档即被标记为已修改） | 是/否/取消 | 点**否**，从不保存 |
| `正在打开…`（只有进度条，无按钮） | 打开较大的文件 | 无 | 不操作，等它自己消失 |
| `文件注意事项` \| `本文件的某些部分无法打开。该文件可能是由更高版本的画板创建的。它将作为一个副本被打开。` | 打开被截断的文件时 | 确定 | 点确定；文档以“xxx的副本”打开，status 仍为 ok，`notes` 里有说明 |
| `文件问题` \| `该文件不是一个画板文件。` | 打开乱码文件 | 取消 | 点取消；判为 `failed`（`原版拒绝打开…`），不重启原版 |
| `错误` \| `由于发生一个错误，此操作无法完成。` | 打开 0 字节文件 | 取消 | 同上 |
| 未登记的弹窗 | — | — | 单按钮点该按钮；含“保存/更改”且有“否”点否；否则确定>否>取消；控制台打印 `[dialog?]` 并记录 |

另有一层兜底：主窗口被禁用却找不到标准对话框（非标准模态窗口）持续 2 秒以上就关掉那些窗口并记录；同一个弹窗点 4 次仍不消失就发 `WM_CLOSE`，9 次后判失败。

语料 30 个文件的验证里，除上表的“保存更改”之外**没有遇到其它弹窗**（所有 `Samples/`、`Tool Folder/` 文件都能直接打开，无许可证/提示框）。

### 失败、挂起与重启

整体失败策略：任何超时、进程消失、弹窗卡死、输出校验失败（EMF 头签名/`nBytes`/`nRecords`/EOF；HTML 缺 `<APPLET>`/`Construction`）→ 记 `failed`/`timeout`（可选截图）→ 记 `stop_required` 并停止本轮，关闭本轮自己的进程，**不自动重启**。原版“干净地拒绝文件”（打开失败弹窗）且文档已清理、会话仍响应时可以继续下一个文件。检查失败原因后，用 `--resume` 人工续跑；再次启动仍须有用户授权。

离线安全回归（不启动或结束任何原版进程）：

```powershell
tools/oracle/.venv/Scripts/python.exe tools/oracle/test_lifecycle.py
```

## 4. 输出的性质（要点）

**EMF 是 EMF+ 双格式（dual）**：头里 `LogicalDpi=600`，设备 4960×7015（A4 600dpi），同一图形既有 EMF+ 记录（浮点，单位为 600dpi 像素）又有 GDI 回退记录（整数，外面套 `MODIFYWORLDTRANSFORM` 的 1/16 或 1/8 缩放，GDI 逻辑坐标 = 文档像素×100 或×50）。每个对象被 `GDIC BEGINGROUP/ENDGROUP` 注释包起来，`BEGINGROUP` 带该对象的边界框（文档像素，整数）。紧跟在 `EMF+ GetDC` 之后的 GDI 记录才是真正生效的绘制（文字、动作按钮就是这样画的，EMF+ 里没有），其余 GDI 记录是 EMF+ 的镜像副本。`emf_dump.py` 默认把 EMF+ 图元与“生效的 GDI 图元”按顺序合并，镜像副本在 `primitives_gdi` 里并标 `mirror`。

**坐标关系（用 baseline 五个文件实测）**：设 `px96` = 设备坐标 × 96 / 600（即 EMF+ 浮点坐标 ÷ 6.25）。则 **`px96 = 文档像素坐标 − (边界框左上 − 10)`**：缩放恰好 1:1（单位是 96dpi 屏幕像素），平移 = 所有对象边界框的并集左上角减去 10 像素页边。

| 文件 | 文档坐标 | EMF px96（圆点中心） |
|---|---|---|
| `point.gsp` | 点 (211,147) | (10,10)，页面 20×20 px（5.29×5.29 mm） |
| `segment.gsp` | 点 (211,147)、(411,281)，线段 `[2,1]` | (10,10)、(210,144)；线段路径 (210,144)→(10,10)，页面 220×154 |
| `midpoint.gsp` | 另有中点 (311,214) | 中点 (110,77)，即 (311−201, 214−137) |
| `midpoint-moved.gsp` | 点 (251,174)、中点 (331,227.5) | (10,10)；中点 (90,63.5) = (331−241, 227.5−164) |

即偏移 `(x0−10, y0−10)`：`point/segment/midpoint` 是 (201,137)，`midpoint-moved` 是 (241,164)。点的画法：红色填充圆（`#ff0000`）直径 8 px（`mediumPoint`），外加 1.25 px 的黑色描边圆；线段笔宽 3 px、颜色 `#000080`。作图次序和对象次序不同（线段、中点先画，自由点后画）。

**绝对偏移不能只靠公式**：页面是“对象边界框 + 10 px 页边”，但会被画布矩形裁剪（边界框出画布左/上边时偏移取 0；对象跑出画布时页面变成整个画布；个别文件里隐藏对象或文字/按钮也参与边界框）。实测在 30 个验证文件里能用“HTML 的 `Point(x,y)` 对 EMF 里直径 8 px 的红点中心”做偏移投票的 15 个文件中，`max(0, 边界框左上 − 10)` 公式精确成立的有 9 个（baseline 4 个都成立），6 个不成立。所以和新程序对照时：**缩放按 1:1，平移请用匹配求出来**（用自由点/红点做众数投票，或最小二乘），不要依赖公式。

**HTML**：`<APPLET … WIDTH=画布宽 HEIGHT=画布高>` + `PARAM Construction`，里面是 JavaSketchpad 构造文本（每步 `{n} 类型(父…)[样式]`，**包含隐藏对象**，标 `[hidden]`），还有 `PixelsPerLengthUnit`、背景色。只导出当前页；多页文档标题/页脚是页名（`Sample.gsp` → `首页`），否则是保存的文件名。UTF-8 编码。

**不产生 EMF 的情况**：空白页（`empty.gsp`）和工具文档（`Tool Folder` 里多数）：另存为对话框正常关闭、无错误框，但**不写文件**（manifest 里 `{"produced": false}`，status 仍为 ok）。HTML 照常导出（空构造）。

## 5. 画布尺寸 = 窗口状态（重要）

EMF 的页面大小和 HTML 的 `WIDTH/HEIGHT` 取决于文档窗口的画布大小。原版窗口**最小化**时，文档窗口保持**文件里保存的窗口尺寸**（如 1606×928、1190×636），与本机屏幕无关，所以结果可复现；窗口为正常状态时文档窗口被 MDI 区域最大化，画布 = MDI 客户区（随屏幕/窗口大小而变），对象超出画布的文件导出的页面和图元会不同。同一 30 个文件在两种模式下导出：HTML 画布尺寸 25/30 不同；EMF 图元（`canon_sha256` 口径，未比较 >3 MB 的两个分形）在 24 个可比文件里有 4 个不同（`Sample`、`经典实例`、`f(z)=…`、`38 实体工具`，因画布裁剪导致页面/图元变化），其余 20 个相同。因此 oracle 默认 `--show min`，并校验 `main_iconic`。manifest 的 `outputs.html.canvas` 记录了每个文件的画布尺寸。正常窗口模式的对照输出留在 `oracle/validation_normal/`（较早版本代码生成，HTML 标题为 `export`，仅供对照）。

## 6. 时间与稳定性（30 文件验证，最小化模式，`oracle/validation/`）

清单 `tools/oracle/validation-30.txt`：baseline 5 个、语料最小的 5 个、`Samples/4.x实例` 4 个、`5.x实例` 5 个、`分形艺术` 5 个、`Tool Folder` 4 个、`Sample.gsp`、`Support Files/Example Tools.gsp`、`4.x实例/经典实例.gsp`。

- **结果**：ok 30 / failed 0 / timeout 0；过程中无重启。EMF 产生 26 个（共 37 MB）；4 个按“不产生 EMF”处理（`empty.gsp` 和 `Tool Folder` 的 `08 迷你坐标系`、`11 箭头工具`、`31 反演`）；HTML 30 个全部产生且通过校验。
- **每文件耗时（含导出两种格式、校验、摘要）**：中位 3.5 s，平均 4.8 s，最大 18.7 s（总计 145 s）。分阶段中位数：打开 1.5 s、EMF 0.6 s、HTML 0.6 s、关闭 0.65 s。普通文件稳定在 3.0–3.5 s；慢的是 `Sample.gsp`（自动播放动画，13–18 s）、`L-圆迭代`（24.8 MB EMF，约 18 s）、`L-龙曲线2`（9.7 MB EMF，约 8 s）。只导 EMF 或只导 HTML 可省约 0.6 s。
- **全量 1431 个的估算**：按“普通 3.2 s + 分形/大文件更慢”，约 1.5–2.5 小时；磁盘约几个 GB（分形 EMF 很大）。可用 `--max-files` 分批，`--resume` 续跑。
- **稳定性**：同一最小化模式重复两遍，HTML 逐字节相同；EMF 字节不同但 `canon_sha256` 相同（25/26，唯一不同的是自动播放动画的 `Sample.gsp`，停止动画后复测一致）。窗口为正常状态时 HTML 画布尺寸 25/30 不同、EMF 图元 4/24 不同（第 5 节）。
- **故障注入**：用 `taskkill` 杀掉原版进程 → 下个文件检测到并重启，重试成功；`--timeout 6` 下 24.8 MB 的重文件超时，自动重启，后续文件正常，再 `--resume` 只补跑这一个；损坏/空文件 2.3–3.3 s 内判 `failed` 并给出弹窗原文。

## 7. 已知问题与限制

- **只导出“当前页”**（打开后的页，通常是第 1 页）。多页文档的其它页没有导出；要导就得切页（页标签/文档选项），未实现。
- **字节不可复现，图元可复现**：同一输入两次导出，EMF 字节不同，但 `canon_sha256` 相同（26 个有 EMF 的验证文件里 25 个相同；不同的 1 个是自动播放动画的 `Sample.gsp`，加了“停止动画”后复测两次相同）。
- **窗口状态敏感**（第 5 节）；不要在脚本运行中手动操作那个原版窗口（把它还原/最大化会改变画布）。
- 自动播放动画的文档：导出的是停止后的某一帧；manifest 有 `busy_after_open` 和 `notes`。
- 原版会在注册表 `HKCU\Software\KCP Technologies, Inc.` 记录设置（最近文件等），并把进程当前目录切到 `oracle/work/in`；这是原版自身行为，无法避免。除此之外 `oracle/runtime/` 里没有新增文件。
- 文件名必须能无损过 GBK（ANSI 对话框）；语料中全部满足。不满足的会改名为 `input_<hash>.gsp`，HTML 标题随之变化。
- 如果原版真的崩溃，Windows 的“已停止工作”对话框（WerFault，别的进程）不会被处理，需要手动关；脚本本身会检测到进程消失并停止本轮。
- 大文件：分形目录的 EMF 可达数十 MB（`L-圆迭代` 24.8 MB，86.6 万条记录）；全量跑要预留磁盘。`emf_dump.py` 解析 86 万条记录约 6 秒、内存可观，`--digest` 比较省。
- 打开失败（损坏文件）、`status=failed`：现场信息在 `dialogs` 和 `error` 里。
