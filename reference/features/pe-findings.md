# Sketchpad 5 静态 PE 基线

本分析只读取文件、解析 PE，并使用另行准备的 UPX 5.2.1 对副本做静态解包及标准库 zlib 对容器数据做限量解压。没有执行目标程序、加载 DLL/OCX、注册 COM、修改仓库原件或修补代码。以下地址均为未重定位的首选 VA；文件偏移从 0 开始。PE 时间戳与版本资源是文件声明，不是可信签名或发布身份验证。

## 产物与复现

- `pe_static_inventory.py`：仅 Python 标准库，读取原始 PE 头、节、熵、SHA256、导入/延迟导入/导出、资源树、版本、调试目录、overlay。无需安装 pefile/capstone；本机这两个库均未安装。
- `pe-inventory.json`：7 个仓库原件的完整清单。`parse_notes` 及单个资源的 `parse_error` 保留失败，不以空列表掩盖缺失。
- `pe-unpacked-inventory.json`：主程序两个变体及 GSP2EXE 静态解包件；Sample 条目保留实际读取错误。
- `pe_followup.py`：重建主程序差异、地址种子和有 64 MiB 输出上限的 zlib 解压。
- `pe-main-variants-diff.json`：两个解包主程序逐节及资源 payload 比较。
- `pe-address-seeds.json`、`pe-address-seeds.md`：字符串、原始 32 位指针命中、412 个 MSVC RTTI 名称候选、CRuntimeClass/vtable/消息表候选和 GSP4 字节命中。
- `overlay-inventory.json`、`pe-overlay-decoded-inventory.json`：zlib 容器与解压后 PE 的静态清单；原始产物位于 `overlay/*.bin`。
- `overlay-nested-pe-headers.json`：GSP2EXE 容器解压后嵌套 PE 的已验证 MZ+PE 头偏移。
- `pe-source-integrity.json`：收尾时重新计算的七个仓库原件 SHA256，全部与首轮清单一致；仓库 `git status --short` 输出为空。

从工作根复现：

```powershell
& 'C:\Users\kelly\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' analysis\pe_static_inventory.py sketchpad5 --out analysis\pe-inventory.json
& 'C:\Users\kelly\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' analysis\pe_static_inventory.py analysis\unpacked --out analysis\pe-unpacked-inventory.json GSP5chs.exe GSP5.exe GSP2EXE.exe Sample.exe
& 'C:\Users\kelly\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' analysis\pe_followup.py sketchpad5 analysis
```

后两个命令依赖已经存在的解包主程序副本。脚本始终保留原文件字节；它们不是通用反汇编器，字符串指针命中不能当作已验证交叉引用。

## 原件身份

七个目标均观察为 I386 / PE32。CLR 数据目录均为零；未观察到托管 PE 元数据。Security 数据目录均为零，不能由此推导目录签名或发行身份。

| 原件 | 字节 | SHA256 |
|---|---:|---|
| GSP5chs.exe | 2,278,616 | `bf22c09822ad2da66f8e3655e5a9cbd6c8e494feaf78690cf118f9261887c7b3` |
| Control/GSP5.exe | 1,978,584 | `5079ae0ae0b6335679fc7e72781892f8284e1b8fc55ebd8ee30d9aea408946a5` |
| Control/AddGSP.dll | 36,864 | `82bd5cd4b1f05e775009d262233f5c4ab2573fadc3482ba7c15d0631d0628959` |
| Control/gspmsg.dll | 9,728 | `6dfd8ceaa7eb8bb087b8b9123efad0a2ca482616f81d66373c24cda11ba0acc7` |
| Control/jhhb5.ocx | 167,936 | `2a3670a6a351c300306ac3828ebf60f3cf6dc8db85d5d911eb36ca7318dd38a0` |
| GSP2EXE.exe | 2,228,001 | `724fd7aae6d01fe4c428d345fb1369782cffe7cda1426b63711bf2ef7e086705` |
| Sample.exe | 1,626,938 | `2b62ed537f4e4c85ac92871029b454e0b8586b8d402e3543291c3409dd45e268` |

## REA 原件资源解析失败的原因

**观察**：GSP5chs.exe、Control/GSP5.exe、GSP2EXE.exe、Sample.exe 都具有 `UPX0`、`UPX1`、`.rsrc` 三节及文件偏移 `0x3E0` 的 `UPX!` 标记。`UPX0` raw size=0、raw offset=0x400；`UPX1` raw size 非零且 raw offset=0x400。它们声明 `SizeOfHeaders=0x1000`，而真实节表终点是 `0x270`，FileAlignment=0x200。因而 `UPX1` 原始数据与**声明的头部范围**真实重叠于 `[0x400,0x1000)`，但没有与 DOS/PE 头字段或实际节表相交。不能把失败只归因为空 UPX0 节的无意义偏移。

主程序 `UPX1` 熵分别为 7.999799 与 7.999830 bit/byte；入口位于 UPX1，导入只有加载/内存管理及每个系统 DLL 的少量代表函数。**推断**：这是压缩布局，入口为壳的解包入口。**验证**：UPX 5.2.1 成功静态解包两主程序，恢复 `.text/.rdata/.data/.rsrc` 和完整导入。没有篡改原件头部来绕过 REA。

原件 GSP5chs 的资源树能枚举 711 个叶子，其中 64 个 payload RVA 不在原件可文件映射范围内；Control/GSP5 能枚举并读取 709 个。原件两主程序的延迟导入目录也指向尚未解包的区域，脚本如实记录不可映射。解包副本可完整读取这些资源和延迟导入，后续函数/资源分析应使用副本。

## 哪个文件承载核心逻辑

| 文件 | 直接观察 | 角色推断及限制 |
|---|---|---|
| GSP5chs.exe | 版本 5.0.6.0、KCP Technologies、产品 `The Geometer's Sketchpad 5.06 Build 1074RK`、描述“几何画板 5.06 最强中文版”；解包 `.text`=2,310,144 bytes | 主要交互/几何/文档核心。不是一个只负责启动另一个程序的小壳。 |
| Control/GSP5.exe | 相同产品/版本，描述“几何画板5.06控件版”；解包代码和地址与中文版几乎相同 | 同一核心的控件配套变体，不能把 Control 目录名理解为另一个独立几何引擎。 |
| AddGSP.dll | 导入 MSVBVM60.DLL 96 个符号，COM 四导出，TYPELIB，产品名“几何画板加载项”，资源 `_IID_CONNECTTOPPT` | VB6 COM 加载项/桥接组件；具体 Office 调用仍需类型库/函数分析确认。尚未判定 native-code 与 p-code 编译模式。 |
| jhhb5.ocx | 导入 MSVBVM60.DLL 151 个符号，COM 四导出，TYPELIB，描述“几何画板控件” | VB6 ActiveX 控件/宿主桥接组件；不能仅凭名字证明全部自动化接口或运行行为。 |
| gspmsg.dll | 四个命名导出，USER32 hook/跨窗口消息 API，`Shared` 节，NB10 PDB=`E:\VC-Projekte\x86.binz\YEGSPMSG.pdb` | 小型本地消息钩子/转发辅助 DLL。 |
| GSP2EXE.exe | 版本资源写明“几何画板5打包器”3.2.0.0；解包后 CODE/DATA/BSS 节、Borland/Delphi 字样、386 个导入，含 Begin/Update/EndUpdateResourceA、CreateProcessA | Delphi/VCL 打包工具。其 2 MB overlay 是嵌套可执行文件容器；不是主要几何实现。 |
| Sample.exe | 小型 UPX GUI PE，带约 1.43 MB overlay；overlay 解压后得到另一个 Sketchpad 风格 UPX PE | 打包输出/样例启动包装器候选。没有运行验证它的启动行为或确切尾部容器字段。 |

主程序 LinkerVersion=8.0，解包后观察到 MSVC RTTI/MFC/ATL 类、MFC 源路径和 `GSP_ReleaseKCPT3.pdb` 字符串。**推断**：原生 MSVC/MFC C++ 构建，MFC 很可能静态链接（没有 MFC DLL 普通导入且包含大量框架代码/RTTI）。Linker 版本不能单独确定完整编译器及优化选项。

## 解包主程序的共同点与差异

| 派生副本 | 字节 | SHA256 |
|---|---:|---|
| unpacked/GSP5chs.exe | 4,714,200 | `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a` |
| unpacked/GSP5.exe | 3,837,656 | `6c5ccf4bbefd9773931ece81c54cb5e657b9978ea148e6b7b8d9043fbba5560c` |
| unpacked/GSP2EXE.exe | 2,508,577 | `397c981ff06c7de929f95d7337c4062ab5733ad9c7300727af5c5f310c04800f` |

两主程序首选 ImageBase=0x00400000，真实入口 RVA=0x001EDDA0 / VA=0x005EDDA0；原件壳入口分别 VA=0x00896010、0x007BEA10。

- `.rdata` 438,272 字节完全相同，SHA256=`8223d7974726c9662023804cc4417c576d4459519403edf71ed12228de91d718`。
- `.data` 文件原始区 65,536 字节完全相同，SHA256=`0344e99575ab890d681838ed1120502fa418a6c01a57af439d765108bd766eba`；内存 virtual size 较大，不能把零填充区算作已读取内容。
- `.text` 原始区同为 2,310,144 字节，仅 41 个字节不同，聚成 8 处。对照可见 RET/NOP/JMP/常量返回等指令字节变化；其功能目的尚不能靠字节差异命名，未执行也未修改。
- `.rsrc` 原始区分别 1,781,760 与 897,024 字节。711/709 资源中 681 个相同 payload，28 个共享路径的 payload 不同；中文版另有 RCDATA `[10,303,1033]`=122 bytes 与 `[10,314,1033]`=112,198 bytes。
- 两者普通导入均为 22 个 DLL、893 个符号；延迟导入均为 d3d9.dll(1)、SBSDK.dll(64)、OLEACC.dll(3)。GDI/GDI+/OpenGL、OLE、文件、打印等接口明确可见；普通导入里未出现独立几何 DLL。动态加载路径仍是未知。

差异位置与完整字节保存在 `pe-main-variants-diff.json`；比较方向为中文版→控件版：

| VA 起点 | span 字节 | 观察 |
|---|---:|---|
| 0x004B21D0 | 6 | `81EC18040000` → `C39090909090` |
| 0x004F323F | 1 | `74` → `EB` |
| 0x004F332B | 11 | 一段代码 → 常量 1 返回相关指令及 NOP |
| 0x004F3342 | 11 | 一段代码 → 常量 0 返回相关指令及 NOP |
| 0x004F7EE1 | 5 | NOP → 相对 JMP |
| 0x00517BCF | 5 | NOP → 相对 CALL |
| 0x005AD803 | 3 | `558BEC` → `C20C00` |
| 0x005C340D | 3 | `558BEC` → `C20C00` |

## 导出入口

- AddGSP.dll：DllCanUnloadNow=0x11002FC2、DllGetClassObject=0x11002F96、DllRegisterServer=0x11002FAC、DllUnregisterServer=0x11002F80。
- jhhb5.ocx：DllCanUnloadNow=0x1100830E、DllGetClassObject=0x110082E2、DllRegisterServer=0x110082F8、DllUnregisterServer=0x110082CC。
- gspmsg.dll：SetCWPMSGHook=0x1000108E、SetGlobalMessage=0x100017FD、SetMessageWindow=0x1000182D、SetWindowMessage=0x10001851。
- 两主程序、GSP2EXE 与 Sample 没有普通导出目录；这不等于没有内部可识别函数。

## Overlay：限量静态解压

`pe_followup.py` 使用 zlib 标准解析器，最大输出 67,108,864 字节；两次均在上限内正常到达流 EOF，无未消费压缩尾部。只生成 `.bin` 文件，不执行内容。

| 来源 | 原件 overlay 起点 | 流在 overlay 内偏移 | 解压字节 | 解压 SHA256 |
|---|---:|---:|---:|---|
| GSP2EXE.exe | 209,920 / 0x33400 | 0 | 4,585,176 | `798caf00959adaa60928b147a5bf982f05dc4795f4091d91d6e00cbe4305f1ec` |
| Sample.exe | 197,632 / 0x30400 | 10 | 2,490,592 | `3ec8745329221d8156df53483091a4caeec6e53fe7885864d32d47d55beabdf3` |

GSP2EXE 的流头是 `78 DA`，压缩流消耗整个 overlay。解压结果以 PE32 console UPX 程序开头，其节原始区终点为 293,888，后面又有两个通过 MZ+PE 头验证的嵌套 PE，偏移 293,888、747,520；它们不是靠随机 `MZ` 字样计数得出的。未对该层容器做递归解包或命名所有内嵌文件。

Sample 流前十字节=`01000101000000010001`，流后十二字节=`d81815000000000000040300`。解压结果为带 UPX 结构的 PE32 GUI，观察到 709 个资源叶及 Sketchpad 风格导入。前后字段的语义尚未验证，不能宣称已重建完整封装格式。

Sample 的单独 UPX 解包命令报告成功及 1,882,938 字节，但随后读取派生 `unpacked/Sample.exe` 先出现 FileNotFoundError，第二次出现 OSError Errno22。没有证实原因，不再重试，不把工具成功消息当作已经取得可重复读取的样本。原件及 zlib 解压 `.bin` 可读取，错误保留在清单。

两个主程序原件分别有 114,392 与 122,584 字节 overlay；静态 UPX 解包前后对应 overlay SHA 保持相同。没有把其中随机 `MZ` 字样当作嵌套 PE，未判断其全部数据语义。

## 后续函数分析入口

优先从解包 GSP5chs 的 `CGSPAppDoc`、`CGSPView` 进入，地址见 `pe-address-seeds.md`。本脚本已经找到 `GSP4` 四字节在代码中出现于 VA 0x00416296、0x00416642、0x004F5B52。前两处可作为读头/兼容格式分支候选，后一处位于 Doc 函数区域，可作为写头/序列化候选；必须通过反编译的调用与数据流确认，静态字节本身不证明具体函数签名。

`CGSPAppDoc` 的 CRuntimeClass=0x0065ADA0、vtable=0x0065AFE4；vtable 槽 2 函数=0x004F59D0，是 MFC Serialize 候选。其消息表位于 0x0065AF58，entries=0x0065ADC0，有 16 条格式有效记录。`CGSPView` 的鼠标消息分派与 `CMainFrame` 的命令消息表也已形成地址种子，便于把资源菜单命令连接到代码。

## 边界与未知

没有运行、原始源码恢复、行为复现、完整文件格式重建或签名信任验证。资源、编译器文本、类型名和 API 导入是可复核的静态证据，具体功能解释均需后续反编译/调用图佐证。原件中不可映射目录的缺失不会被推导为“功能不存在”。核心与控件版虽极为接近，仍不能将二者视为字节相同或行为完全相同。
