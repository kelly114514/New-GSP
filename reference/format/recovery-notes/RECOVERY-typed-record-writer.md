# 原 typed record writer 恢复

本单元恢复原函数 `0x004A7430`，源码为 `include/gsp/typed_record_writer.hpp` 与 `src/typed_record_writer.cpp`。它保留原量测/执行双回调与真实 64 字节 `TypedContext32`，没有设计新的通用写入器、文件 schema、事务接口或恒成功 record sink。

## 原 ABI 与接口

原入口：`ESI=TypedContext32*`，`EAX=四个metadata u32的指针`，cdecl 栈参数依次为 callback、record_arg1、record_arg2；返回 EAX 为 signed32 status。原 callback 是 `cdecl(TypedContext32*)`。源码正规化为：

```cpp
std::int32_t FUN_004A7430(TypedContext32& context,
    const std::uint32_t* destination_meta_four_words,
    TypedRecordConverter32 converter,
    std::uint32_t record_arg1, std::uint32_t record_arg2,
    const TypedRecordWriterEnvironment& environment);
```

`TypedRecordConverter32` 规范化为 `(void* user, TypedContext32&)`，只显式增加环境参数，仍执行原 callback 的两次真实状态操作。`TypedRecordWriterEnvironment` 持有真实全局槽指针、已有 `BlockTableAllocator` 和显式注入的 record IO 边界；没有默认实现或成功替身。

## 已恢复的精确顺序

1. 读取原 `DAT_006B6BAC`：非零→destination representation=1，零→2。随后按原顺序逐个读取/复制四个 metadata word 到 destination +0x0C/+0x10/+0x14/+0x18，不是另造结构或一次 schema 转换。可能与上下文重叠的源指针仍保留原顺序。
2. 仅设置 source representation=0、source bytes=0xFFFFFFFF、action=1、destination bytes=0xFFFFFFFF。advance、source selector/base/handle、其余字段保留。执行第一次 callback，量测和其它副作用均真实发生。
3. 第一次 status>=20 立即返回该值；其余路径以 signed max(0,第一次status) 初始化累计状态。负值不会成为累计失败码。
4. 将第一次 callback 后 destination bytes 保存为 **固定量测快照**。以 signed32 `>1024` 决定是否分配；否则读取原 `DAT_006BB518` 槽，使用共享缓冲。这个槽在第一次 callback **之后**读取，不能在函数入口快照。非标准长度 `0xFFFFFFFF`/`0x80000000` 会走原 signed 小缓冲路径，源码没有擅自改成 unsigned 比较。
5. 大缓冲路径调用原 `FUN_0043CB30`，原 ABI 为 `EBX=量测快照字节数`、栈参数 tag=0；EAX 返回指针。失败返回100，并保留已发生的第一次 callback/context 副作用；不会执行第二次 callback、IO 或 free。tag=0 不请求 allocator 的 flag 0x04 清零行为。
6. 设置 action=0、destination data=选定buffer，执行第二次 callback，按 signed max 合并状态。只要累计状态<20便调用原记录 IO。第二次 callback 修改的 destination bytes 不会替换量测快照。
7. 记录 IO：原 `FUN_004B9DF0` 的 EAX=第一次量测字节快照，cdecl 栈依次 record_arg1、record_arg2、buffer；返回 signed status。调用前 writer 也把 record_arg1 放EDX、record_arg2放ECX，随后按同值压栈。源接口显式传入这些值，仍使用 writer 当时选定的buffer，即使第二次callback再次修改共享槽也不改变它。已有 record-dispatch Evidence 观察到首个栈参数的低16位被当作句柄查表，记录层实现见[记录IO](RECOVERY-record-io.md)，本单元不重复实现。
8. 若分配过缓冲，无论第二次 callback/IO 的状态如何，都调用原 returning CRT free 边界 `0x005EDDB9`，并返回保存的累计状态。共享buffer从不释放。

callback、allocator、recordIO的任何已经发生的上下文/全局副作用均保留；本函数没有回滚、清零或对缓冲字节做额外“规范化”。

## Ghidra 的 noreturn 误标

REA Evidence `ev_74a8f6714190dd6d68ab74c2f774fd2da33e53350f7c641fb1a012c8839ba18b` 保留完整原函数 Listing 主体，但把 `0x004A74FA` 调用 `_free` 标成 terminal，因此漏掉真实三字节 fallthrough，伪代码误呈现为“不返回”。

本单元使用本机已有 LLVM objdump 22.1.8，对固定 SHA 原件的完整区间 `[0x004A7430,0x004A7509)` 独立反汇编。精确尾部为：

```text
0x004A74F9 PUSH EAX
0x004A74FA CALL 0x005EDDB9
0x004A74FF ADD ESP,4
0x004A7502 MOV EAX,EDI
0x004A7504 POP EDI
0x004A7505 POP EBP
0x004A7506 POP EBX
0x004A7507 POP ECX
0x004A7508 RET
```

217字节函数 SHA256=`f2ce6ad4b0a8569d8ed5a116cbb98776b90cd693c4515250afcefc64600fe335`。完整 LLVM Listing 在 `tests/typed_record_writer_original_listing.txt`；它是独立工具证据，不伪造 REA Evidence ID。原 PE SHA256=`de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`，源字节未修改。

## 实际 MSVC x86 差分

运行命令：

```powershell
& '.\recovered\native\tests\typed_record_writer_build_probe.ps1'
```

使用本机已有 MSVC 14.44.35207 与 Windows SDK，x86，`/O2 /W4 /WX /EHsc /MT /fp:strict`。探针输出位于本机 `GspRecovery/sketchpad5/typed-record-writer-probe`。

已通过 **387,069个原机器码差分场景，0差异**，结果在 `tests/typed_record_writer_validation.json`：

- 量测/转换/IO 三阶段 signed status 组合含 INT_MIN、负数、0、1/4/5/13/19、20/39/100、INT_MAX；核验warning传播、20阈值、负值处理及IO错误。
- 量测长度0、1、12、28、1023、1024、1025、2048、8192，以及负signed位型；超大正长度仅测试真实null分配失败路径，没有假装小allocation是超大合法缓冲。
- mode 0/1/2/0xFFFFFFFF；第一次callback改变mode、共享槽、advance、source selector与其它真实context字段；第二次callback改变长度和共享槽，验证第一次长度/选定buffer的快照语义。
- 外部metadata，以及metadata与source/destination上下文重叠的逐word副作用；不将原输入前提额外收紧为不重叠。
- allocation尝试73,081例；returning free 36,576例；IO160,232例；measurement-stop119,108例；conversion-stop71,224例；allocation-failure36,505例。
- 比较返回EAX、每个边界事件前的全部64字节上下文、最终上下文、allocator bytes/tag、recordIO bytes/两个原参数/buffer、free顺序、全局槽变化，以及四个8,224字节缓冲（含前后canary）。

运行 oracle 只复制该217字节函数；赋执行权限前用BCrypt核验SHA256，并逐一核对/重定位两个全局操作数与三个已声明的外部call目标。原callback的间接调用、内部条件分支和free后的真实epilogue保留原码。原/恢复双方使用同一组有可见副作用的测试callback/allocator/IO/free边界；没有加载PE、导入表、UI、线程、网络或应用生命周期。

## 依赖与验证边界

`FUN_0043CB30`的压力回收/重试已在[分配模块](RECOVERY-allocation.md)恢复，`FUN_004B9DF0`已在[记录IO](RECOVERY-record-io.md)恢复；writer通过显式环境调用这些实现。CRT原语、真实FILE和完整生命周期仍是外部边界。隔离差分只验证writer对边界的顺序、参数和状态合并。

callback测试用于隔离writer协议；真正对象头、父引用等callback的组合原码差分见[对象保存集成](RECOVERY-serialization-integration.md)。本单元不以测试callback替代生产callback，也不声称完成完整对象序列化闭环。
