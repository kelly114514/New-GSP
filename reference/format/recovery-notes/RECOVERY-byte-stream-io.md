# 原 byte stream IO 恢复

本单元从固定 SHA 的原程序恢复四个原函数，生产源码为 `include/gsp/byte_stream_io.hpp` 和 `src/byte_stream_io.cpp`。真实生产代码直接复用 `StreamRegistry32`、已恢复的 blocktable 和 `memory_stream.cpp`，没有用统一成功/失败 sink 替代内存后端或记录层。

| 原函数 | 原 ABI | 正规化源 API |
|---|---|---|
| 0x004B9590 byte write | EAX=bytes，ECX=src，cdecl stack(handle) | FUN_004B9590(handle,src,bytes,env) |
| 0x004B98D0 byte read | EAX=bytes，CX=handle，EBX=dst | FUN_004B98D0(handle,dst,bytes,env) |
| 0x004BA9B0 seek/error rollback | EBX=signed offset，EDI=origin，cdecl stack(handle) | FUN_004BA9B0(handle,offset,origin,env) |
| 0x005496E0 errno translate | cdecl()，读取原 CRT errno slot | FUN_005496E0(env) |

全部返回 signed32 EAX status。handle 在每次实际查表时按低16位 sign-extend；完整传入值仍保留在后端调用参数，不能先把整个接口的 handle 不加区分地截断。

## 真实公共布局及重复查表

复用公共 `streams.hpp` 的 `StreamState32` 已知52字节前缀：type/+0、opaque data/+8、position/+0x18、max record/+0x1C、logical end/+0x20、sticky error/+0x24。没有声称这就是完整原类。`StreamRegistry32.table_slot_006bb560` 是原全局表指针的真实槽，allocator 仍为原 blocktable 分配边界。

原 Listing 多次调用 `0x00434150` 的 ensure/offset/base 输出接口，并在 FILE 路径若干处调用 `0x004341D0`。源码保留每次调用及每次全局槽重读，不将整个函数缩成单一缓存 `StreamState32*`。内存压力、表槽改变和查表副作用可以使这些区别可观察。无效句柄/失败查址随后仍属于原空指针访问前提，没有虚构一个“安全返回31”或成功分支替换它。

read 的 default 分支不是统一错误：`0x004B99FE MOV EDI,[ESP+0x10]` 取得**第二次查表的 byte-offset 输出**。这个原始位型成为 status；offset=0 可表现为成功并推进position；offset!=0会成为sticky error。它不是未恢复的随机EAX，也不是base指针。源码明确保留这个行为。

## Write 的精确行为

- 第一次查表保存原position；第二次查表检查sticky error。若非0，第三次查表重新读取并返回error，不能直接返回第二次缓存值。
- 重新查表取得type。type1再查表取得 FILEopaque，调用原 errno slot并写0，再执行 fwrite(src,1,bytes,file)。返回count恰等于bytes即成功；short/over-count均经真实5496E0数值映射。errno=0的short write仍返回31。
- 非FILE类型直接调用已恢复 `FUN_004B9410(handle,src,bytes,registry)`；2/3/4/default的具体内存行为归该真实后端实现，没有在byte层重写一个近似版本。
- 成功路径再查表，把position按u32 wrap加bytes，若新position大于logical end便更新end。它不会额外把sticky error写0，后端/stdio已发生的其它状态修改不回滚。
- 错误路径先调用真实 `FUN_004BA9B0(handle,saved_position,0,env)`，随后再次查表把**原write错误**写入sticky并返回。seek失败或已有sticky导致拒绝定位不会覆盖这个原错误；部分缓冲写入也不会回滚。

## Read 的精确行为

- sticky error检查与返回路径保留两次独立查表。正常路径再查表分派type。
- type1经真实address helper取得 FILEopaque；errno清0；fread(dst,1,bytes,file)。完全count成功不读取feof。非完全count先feof：非0→25；否则调用5496E0映射。FILE错误先通过address helper写sticky一次，随后公共结束路径仍重复查表/写sticky，不能省略这次可观察写入/查址。
- type2调用 `FUN_004B9760`；type3调用 `FUN_004B9860`。原type3入口bytes来自**ESI**，不是switch后EAX=2；源API正规化后显式传入真实bytes。
- type4不拷贝字节，status=0；公共结束路径仍按bytes推进position并清sticky。
- default使用前述lookup byte-offset status；所有类型最后先重新查表，仅status==0时推进position，再重新查表写status。

## Seek 与错误回退

已有error非0时，仅error==25且origin!=1允许继续；其它路径直接返回原sticky，保留position且不调用FILE seek。继续时origin==0把tracked position设为offset；**任何非0 origin都先加offset**，包括2。source用u32算术保留wrap与原unsigned end比较，不改成新的通用seek语义。

logical end!=0且tracked position>end直接产生25；否则非FILE类型成功。type1重新查表取得FILE，errno清0后真实fseek(file,offset,origin)：返回0成功，其余经5496E0映射。最终再查表写sticky。tracked position在边界/stdio失败后不会自动恢复；origin2的FILE自身seek行为与tracked position的这套原更新规则均保留。

## errno/stdio 的诚实边界

`StdioCallbacks32` 显式提供 original-FILEopaque 的 read/write/seek/eof 与原CRT errno slot。没有假定现代宿主 `FILE` 与原CRT内部布局兼容，也没有自行构造原FILE内存。回调参数保留32位element size/count、signed offset/origin和返回count/status。生产无默认callback，调用者必须提供真实适配或明确测试依赖。

5496E0本身已恢复，使用原数值表，不用宿主 errno 宏代替：

| target errno | status |
|---:|---:|
| 2 | 24 |
| 9 | 26 |
| 13 | 22 |
| 17 | 29 |
| 22 | 30 |
| 24 | 28 |
| 28 | 27 |
| 其它（含0） | 31 |

## Evidence 与原码范围

REA 的四份完整 Listing 来自：

- write：`analysis/rea-native/record-header-write.json`，`ev_4987a7a8a6a483cb65e9077b25e2ea8e0492bcc64b6444b9d39a142c21d14ea8`。
- read：`analysis/rea-native/record-header-read.json`，`ev_b2beb6b8ab2736d790b078726bbcda1cac6bf328dad1dec5f3cdc092db0a1391`。
- seek：`analysis/recovery-pass5/stream-seek.json`，`ev_72d67d04bc6323d221db9c5019dd4ab83668ecc1a47b6a2d71f9146605723986`。
- errno：`analysis/recovery-pass5/stdio-error-code.json`，`ev_4d6050bfca392440ea194007637a8b0ec4476a325e0c7c7aa0e90f567c537555`。

本机现有 LLVM objdump 22.1.8另对相同SHA文件做精确范围解码，生成 `tests/byte_stream_io_original_listing.txt`，不为它伪造REA Evidence ID。伪代码中的漏参、未初始化var和错误索引均以Listing/机器码为准。

| 原范围（末地址不含） | bytes | SHA256 |
|---|---:|---|
| [0x004B9590,0x004B975E) | 462 | 2f8d056974a9bd87ec4ba5827383da0829c72cc1c3e8d944b6c984c464920c15 |
| [0x004B98D0,0x004B9A71) | 417 | 429724029beb06e53cd88b2a33d3ced8b18669bd9043489dcd606f5f07f3b33e |
| [0x004BA9B0,0x004BAAAC) | 252 | 8bc8428256d125fe13d42e1ff2dec38fd478c1041f134ccdc7c5c3367325c4ab |
| [0x005496E0,0x0054972D) | 77 | 274a7e03c7ef7992ebebda94b9fa1b25e57ff6ea7afdfb8d8f0c63481726c342 |

read jump table在0x004B9A74共16字节；errno jump table在0x00549730共32字节，index table在0x00549750共27字节。全部表的SHA、目标地址、每个相对call、每个006BB560绝对操作数与三处跳转表操作数在 `tests/byte_stream_io_original.json`，供根工程稀疏原码组合oracle复用。

## 实际验证

独立探针：

```powershell
& '.\recovered\native\tests\byte_stream_io_build_probe.ps1'
```

本机 MSVC x86 14.44.35207，`/std:c++17 /O2 /W4 /WX /EHsc /MT /fp:strict`。实际通过 **174,284例、0差异**：write13,596，read13,596，seek16,020，errno131,072；结果 `tests/byte_stream_io_validation.json`。

覆盖所有type1/2/3/4/default，低16位句柄和block内非零offset，负/0/19/20/25/26/100 sticky，0/1/7/64/128/0xFFFFFFFF bytes；stdio完全/short/over-count、errno全部映射、feof正负非0、seek失败；u32位置wrap、logical end 0/边界、origin -1/0/1/2/3；后端部分写与错误、已有sticky阻止rollback、rollback本身失败；全局表槽在第N次lookup或stdio/backend内部切换及每次lookup可见副作用。errno数值遍历[-65536,65535]。

比较返回EAX、两代全部stream前缀、errno、opaque FILE游标、缓冲部分读写/canary、全局表槽以及准确table/address/stdio/backend调用顺序和参数。原write/read内部的seek/error调用仍进入原函数机器码。只有stdio、table和memory backend在这个**独立组件测试**中作为双方一致且可注入fault的显式边界；这些测试函数不进入生产library，不声称代替已恢复后端。根工程另把真实byte→memory→blocktable连接到原record函数做组合差分，验证记录单元报告由根/record模块保存。

所有oracle片段/表都在赋执行权限前用BCrypt核验SHA，修正仅限逐项验证过的绝对global/table地址、jump table目标和声明callee的相对call。没有加载原PE、进入应用入口、运行UI或目标生命周期。

本恢复不宣称原CRT的FILE内部实现、系统错误来源、实际磁盘故障、非法指针或并发全局表改写已被完整复现；这些边界和原生有效缓冲前提仍明确保留。
