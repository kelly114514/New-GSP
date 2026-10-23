# 原生分页表恢复

本模块恢复几何画板主程序中 `0x00433F90..0x00434295` 的九个原函数。代码按原指令、32位字段和失败分支转写；没有用 STL 容器替换原表。文件名与字段语义名是恢复标签，不声称取回了原始源码文本或原始编译单元名称。

原件来源为 `analysis/unpacked/GSP5chs.exe`，SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。该副本来自主程序静态解包，未修改原件。所有源地址都是首选VA，ImageBase `0x00400000`。

## 原结构与边界

`gsp::BlockTable32`严格为`0x1C`字节，指针32位。字段依次是元素字节数、块内索引mask、右移位数、块指针数组容量、块指针数组、分配tag低16位、未知16位、high-water。创建时只写`+0x14`低16位；`+0x16`的两个原字节保持分配器提供的状态。每块元素数为不小于请求值且至少8的2的幂，元素宽度向上补为偶数，块延迟分配并清零。

这是一套通用分页存储表。原生流状态是它的使用方之一；它本身没有FILE或几何对象依赖。

`BlockTableAllocator`显式暴露`0x0043CB30/0x0043CBE0`及CRT free边界。[分配模块](RECOVERY-allocation.md)已恢复内存压力回收/重试策略，可通过`bind_allocation_environment`绑定。CRT malloc/realloc/free原语、reserve槽的创建和拥有权仍由环境提供。回调user与cdecl签名是工程接口；原custom寄存器约定见`provenance-storage.json`。本表的隔离测试使用host allocator，只证明表算法，不独立证明分配策略。

## 原函数及保留的行为

| 原VA / 恢复API | 恢复的行为 |
|---|---|
| `0x00433F90` | 分配表；元素宽度补偶；计算块大小、初始指针容量；tag高16位仍传给两次原分配边界，表里仅存低16位；第二次分配失败释放表并返回空 |
| `0x00434050` | 接受空表；按顺序释放非空块，再释放指针数组，最后释放表本身 |
| `0x00434090` | 分配并清零指定块；分配失败仍把该slot写空。直接调用它覆盖已有slot时不先释放旧块，按原行为保留 |
| `0x004340E0` | 容量约增长25%，或至少到指定块号+1；通过指针输出参数取得可移动的重分配结果；失败不提交table字段；成功清新增指针区 |
| `0x00434150` | 先清block-base输出；负索引返回0且不改offset输出；非负索引先写块内offset，再按需增长/分块；成功才推进high-water，返回完整EAX的0/1 |
| `0x004341D0` | 调用ensure后返回块基址加offset，失败返回空 |
| `0x00434200` | 只清零已分配块；保留分配、容量和high-water |
| `0x00434240` | 返回high-water字段 |
| `0x00434250` | 用signed IDIV算最后保留块；只释放其后的非空块并清slot；保留当前块内容和指针数组容量；high-water直接设成参数，即使大于先前值 |

`truncate(-1)`在合法每块大小下保留第0块，这是原signed IDIV得到0再加1的结果。没有改成新的“清空全部”语义。更负的参数可能使原代码访问负块号；本模块没有新增原来没有的参数校验。

创建时极大的正block-size请求可能让原有32位左移循环不终止；整数除法也保留x86的有效输入边界。差分测试没有执行故意非终止或无效指针的场景。源API归一化为cdecl；未建模无业务结果的偶然寄存器值/EFLAGS，也尚未恢复所有原调用者。

## 证据完整性与Ghidra缺口修正

主要REA Evidence IDs见`provenance-storage.json`及原`analysis/recovery-pass2`导出。已有`blocktable-clear.json`、`blocktable-high-water.json`其实是“No procedure exists”错误，没有作为成功函数分析引用。

Ghidra把CRT free标作noreturn，截掉了创建、销毁、truncate的正常后继。例如：

- `0x00434044..0x00434048`：创建失败后恢复栈并清EAX。
- `0x0043406D..0x0043406F`：逐块free后的栈恢复。
- `0x00434081..0x0043408B`：销毁函数还free表自身并正常恢复寄存器。
- `0x0043427D..0x00434286`：truncate在free后恢复栈、把被释放块slot置0。

为此使用本机LLVM objdump 22.1.8直接反汇编同SHA原件的精确范围，结果保存在`tests/blocktable-original.disasm.txt`，并抽取774字节范围`[0x00433F90,0x00434296)`为`tests/blocktable-original.bin`。该范围SHA-256为`0ffb71680f9daee7dea94b55fc68a74aeff8b2985cf0af2feb9417d873f0f2f1`。没有启动PE入口或载入目标DLL。此处精确字节范围与文件hash是证据，LLVM结果没有伪造REA Evidence ID。

## 差分验证

测试`tests/blocktable_differential.cpp`只执行上述已固定hash的九函数簇副本。内部调用仍指向簇内原机器码；13个确切CALL点仅改接四种host边界：allocate、reallocate、free、memset。转接前核验原CALL目标，内存写完后改为只读可执行。没有PE入口、窗口、网络或目标导入表初始化。

host allocator是独立的测试arena，不是生产恢复。它每次按固定位置分配、用`0xA5`填充，重分配始终移动，允许指定分配/重分配失败。每个场景先跑原函数，再重置同一arena跑恢复函数。比较全部使用内存（含未知字段和被释放前内容）、输出值、分配参数、移动结果、释放顺序和分配存活标记。

已通过2,428个场景：创建参数组合（含奇数/零元素宽度、负/零预期数量、预期数量32位溢出、tag高16位）、两次创建分配失败、跨块和已有块重复访问、负索引/INT_MIN拒绝、INT_MAX增长失败、增长后块分配失败、重分配失败且临时输出被改写、clear、非单调truncate、直接blockalloc失败覆盖slot、destroy。与源代码一一对应的断言不能代替该原机器码比较。

统一CTest中的`original_blocktable_differential`验证2,428组表算法场景。源码和实际验证产物身份见`provenance-storage.json`；其它模块的测试不扩大本模块覆盖范围。

可复现fixture提取：

```powershell
python tests/blocktable_extract_fixture.py ../../analysis/unpacked/GSP5chs.exe tests/blocktable-original.bin
```

测试执行参数为fixture路径。测试需要MSVC x86、C++14或更新版本、Windows BCrypt（源码通过`#pragma comment`链接bcrypt.lib）、`NOMINMAX`（避免Windows宏干扰标准算法）。测试已登记于统一CMake构建。

原分配策略由独立模块验证；全软件生命周期和完整调用者的跨模块错误恢复仍未验证。局部差分即使全部通过，也只证明这些表算法在所列host边界和场景下与所选原机器码一致。
