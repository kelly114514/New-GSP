# 原生 memory stream 恢复

本模块恢复`FUN_004B9310`追加块、`FUN_004B9410`内存写、`FUN_004B9760`分块读、`FUN_004B9860`固定内存读。生产代码复用真实恢复的blocktable与显式allocator边界，没有把short handle转换成新map，没有成功stub，也没有把原机器码链接进生产库。

## 固定来源与结构

目标为`analysis/unpacked/GSP5chs.exe`，x86，首选ImageBase`0x00400000`，SHA-256：

`de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`

| 原函数 | Evidence | Evidence ID |
|---|---|---|
| `0x004B9310` | `recovery-pass5/stream-append-block.json`，243字节完整Listing | `ev_9cf9d2698b8759c15ae30a963b68ceb1b230043fc70dd1a24dc144a574d1b5e7` |
| `0x004B9410` | `recovery-pass2/stream-memory-write.json` | `ev_a38317170bbc80e69afd10c2949b4d58da39b817973c7da038799d03859153f8` |
| `0x004B9760` | `recovery-pass2/stream-memory-read.json` | `ev_bf63b206793f02563dad05ebd94e709dabc3aeb710ee0e1aa29abf9c6a8c8c0a` |
| `0x004B9860` | `recovery-pass2/stream-third-read.json` | `ev_ba03813c581a7ec68f03061dfc98d86ce365a42e9d27390c408b3951f81d9d4c` |
| `0x0043CB30`依赖 | `recovery-pass2/allocator-boundary.json`，flag4清零 | `ev_c0aa64c028e34eca9406c0b0604e23546c43112d101a1d55e4132e1ac31e2b00` |

本模块未开启REA。`tests/memory_stream-*.disasm.txt`由本机LLVM objdump对相同SHA原件的明确函数范围只读反汇编，未冒充新REA Evidence。

公共`streams.hpp`由根代理维护，本模块复用其已知0x34字节前缀。实际访问为type`+0`、数据/FILE复用槽`+8`、固定写bound`+0x0C`、position`+0x18`、logical end`+0x20`、error`+0x24`、链头`+0x2C`、首缓冲长度`+0x30`；`+0x14`不是追加块大小的来源。链块有8字节前缀`{u32 bytes,next}`，payload随后。字段名是恢复标签，未声称得到原厂完整声明。

handle每次都按低16位有符号整数处理。生产`stream_from_handle`通过真实`FUN_004341D0 → FUN_00434150`取得页表块地址加offset；原机器码backend直接调用`0x00434150`后自己相加。两条链使用同一真实分页表算法，查询可以增长/分配表并推进high-water。`StreamRegistry32`持真实table slot地址，不能缓存成永远固定的一张表。

## 原ABI与恢复API

| 函数 | 原输入 | 源接口 |
|---|---|---|
| `4B9310` | EAX=最小payload，stack[4]=handle | `(handle,minimum_payload,registry)`，返回块指针 |
| `4B9410` | stack为handle、src、bytes | `(handle,src,bytes,registry)`，返回32位状态 |
| `4B9760` | EAX=bytes、CX=handle、stack[4]=dst | `(handle,dst,bytes,registry)` |
| `4B9860` | **ESI=bytes**、CX=handle、stack[4]=dst | `(handle,dst,bytes,registry)` |

源API均归一化为cdecl；fixed reader的长度不是EAX。source只使用显式registry/allocator，没有生产全局adapter。

## 保留的内存与错误行为

追加块先查询stream，令divisor=2，按`logical_end >> 12`每次右移2位来倍增divisor，再重新查询stream，以`logical_end/divisor`与最小payload的较大值分配`payload+8`字节。分配参数为4；原allocator明确在该bit存在时清零。函数只写payload长度，**不额外写next=0或memset**。分配成功后第三次重读registry，再向当时stream的链尾挂块。测试在allocator中切换真实table slot，证明块链接遵守这次重读，而不是缓存旧stream。另验证第一次lookup分配引发换表后，第二次lookup使用新表的logical end，并分别覆盖第二、第三次lookup增长/分配失败及其部分副作用。

内存写完整保留type分支：type2按首缓冲和链块跨段复制、必要时真实append；type3按`position+bytes`的32位wrapped unsigned结果与`bound_0c`比较，超界返回35并设置error；type4直接返回0；其它type返回101，不把它们改成成功。分块写扩块失败返回100，并保留已经复制的前段，不回滚，也不擅自设置error。

chunk reader依首缓冲/块链读取，不额外用logical end截断。定位阶段沿链耗尽时返回25且保持原error；已经开始复制后耗尽链则返回25并写error=25，保留部分输出。零长度块也依原逻辑继续走链。fixed reader按`position+bytes`的wrapped unsigned结果与`logical_end_20`比较，超界先设置error=25并返回，完全不复制。

这些backend都不更新position、logical end或max-record字段。后续byte-stream函数负责记账，不能在这里再推进一次。成功路径也不清理已有error。

### 原fault分支没有被改写

write在`position`越过现有尾块的定位分支调用append后，`0x004B94E1`取的是`new_block->next`，随后`0x004B94E4`解引用它；flag4分配通常使next为零。源码保留这条读取，而没有“修正”为new_block自身。原有无链定位、失败的真实table lookup也可产生空指针访问。

测试使用独立无C++析构局部变量的SEH wrapper，捕获这些限定函数的访问异常，比较原码/源码异常码以及异常前的内存、链表、分配副作用；没有把异常当成成功返回。非终止环、任意破坏链和未受控非法内存输入不在测试域。不存在启动完整原程序或执行其PE入口的步骤。

## 实际验证与可复用oracle

已实际使用MSVC 2022 Win32/x86、`/std:c++17 /O2 /MT /EHsc /W4 /WX`编译`memory_stream.cpp`、真实`blocktable.cpp`和差分测试。结果：

```text
PASS: 130934 memory stream differential scenarios; 23646 bounded original/source fault cases; 68954 matched allocator events; 4 routines with real paged lookup, partial writes and registry-slot reentry
```

稳定日志与独立测试exe位于`tests/memory_stream-build/`。header、生产实现、测试和oracle loader在通过后未修改；哈希、输入、ABI和依赖记录于`provenance-memory-stream.json`。根CMake/脚本/状态由根代理总集成，本模块未编辑。

覆盖首缓冲0/1/4/8/16字节、7种含零块的链形、块边界和越尾位置、0–64字节复制、固定区间的32位wrap、已有error、分配/表增长失败、懒分配handle、带高16位的handle别名、负short handle限定fault、追加容量尺度和allocator重入换slot。比较全部使用arena（含表/链/padding）、外部输入输出缓冲、返回/异常、分配/重分配/释放参数与顺序和存活记录。

`tests/memory_stream_oracle.hpp`可供整链测试复用，构造参数为fixture目录、原registry slot地址及五个明确host库边界地址，通过`entry(original_va)`得到入口。它装载append243、write373、chunk242、fixed99及已验证blocktable簇774字节，共1,731字节；生产从不包含该header。5个fixture均在执行前核对SHA；重定位6处registry操作数、30个精确CALL，blocktable内部3个相对调用保持不变。没有将handle lookup换成测试map。

`tests/memory_stream-fixtures.json`保留所有哈希、范围、原始CALL目标与全局操作数，提取器逐点核验它们：

```powershell
python tests/memory_stream_extract_fixture.py ../../analysis/unpacked/GSP5chs.exe tests
```

测试exe只接受一个参数：上述tests目录。原allocator内存压力回退和CRT memcpy/memset实现仍为明确库边界；测试arena只模拟选定分配成功/失败、flag4清零和移动resize契约。局部差分没有证明完整文件系统IO、GSP加载写回、全部调用者或完整几何画板恢复。
