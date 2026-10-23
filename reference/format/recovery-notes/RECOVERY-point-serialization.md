# 原点坐标 payload 序列化恢复

`point_serialization.cpp` 恢复两个原函数：`0x00445EE0..0x00445F24` 的 69 字节 converter，以及 `0x00445F30..0x00445FA9` 的 122 字节 serializer。生产源码实际调用既有 `FUN_0040E440`、`FUN_0040E130` 和 `FUN_00445E10`，新增可审计恢复代码范围共 191 字节；没有把原 PE 机器码作为生产实现。

converter 无条件按 unsigned 比较 endpoint 的 `bytes_04`：小于 16 时返回 39，尚未读取源或写入目的；`read_serialized != 0` 且长度大于 16 时返回 4，其余返回 0。长度足够时，依次读取并写入四个 dword。这里没有浮点转换，也没有字节序交换。源码用 x86 指令保持四次读写的原顺序，包括非对齐和部分重叠；不能把该行为概括成 `memmove`。

serializer 在所有 action 之前检查 source representation2：长度小于 16 立即返回 39，大于 16 先置 warning4。随后通过真实 typed helper 处理 native offset `0xF0`、native/serialized size 各 16，最终取初始状态和 helper 状态的 signed 最大值。只有 `status < 20 && destination.representation == 0 && (action == 0 || action == 2)` 时，才把 destination 的 `meta_0c` 当点对象调用真实 `FUN_00445E10`。该指针和 typed resolver 返回的 payload 地址用途不同，source 中未省略或替换这一步。

原 source/destination 端点、selector、版本字段、指针推进与 action2 交换均保留既有 typed helper 的行为。对于 action2 的保留 selector，源 API 接受既有 `TypedTransferVolatile32`，显式传递入口 ECX 和第一次 memcpy 后的 ECX；默认零值不代表原 CRT 的真实寄存器出口。数值处理继续使用既有 `PointNumericRuntime32`，不据此声称恢复了原 floor/integer CRT。

`tests/point_serialization_extract_fixture.py` 首先核对原 PE SHA256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`，从 PE section 映射中提取八个固定片段并保留完整 converter/serializer 的 LLVM Listing。converter 片段哈希为 `c9e82996e848805da8e43730c301b95a00264b20a2329a34564b0acad00c6dfe`，serializer 为 `c59e5e70d1de7c440d687899ef9fd6de6b7ffd81ef64180f57eb02229cfffbf0`。原 serializer 的 REA Evidence 为 `ev_6a10d619cd1e3de9e33cf0a450a5a8913c234c50d2c18c872cd000d0f379e17d`，来源 `analysis/recovery-pass3/point-serializer.json`；converter 使用完整原 Listing 证据，不虚构额外 Evidence ID。

独立 MSVC x86 `/O2 /W4 /WX /fp:strict` 构建实际通过。差分执行原 converter、serializer、typed helper、resolver 和 point cache 的机器码，并与对应恢复源码比较；各片段在赋予执行权限前再次通过 BCrypt SHA256 核对。测试只重定位核对过原值的操作数/调用，不执行 PE 入口。装入 861 字节 code/table/padding 片段，其中函数体 826 字节、resolver 内嵌表 32 字节、padding 3 字节，另有 24 字节数值常量。

- 39,936 个 converter 案例：unsigned 长度边界、四种 read 值、39 种前后重叠与非对齐位置、随机全缓冲字节；短记录使用空数据指针验证提前返回。
- 327,360 个完整 serializer 案例：action0/1/2/3/unsigned max、source0/1/2/3/unsigned max、destination0/1/2/3、source/destination 独立长度、推进、五个正常 selector 及 action2 的保留 selector ECX 路径。
- 三种 x87 precision 乘四种 rounding 共 12 个模式，两个明确 CRT 策略。包括正负零、上下限、无穷、quiet/signaling NaN、subnormal 及随机坐标。比较返回状态、整个源/目的缓冲、完整 64 字节 context、98,126 次数值调用的顺序和输入输出 bits。

可运行 `native/tests/point_serialization_build_probe.ps1` 复现本模块构建；独立输出位于 `%LOCALAPPDATA%/GspRecovery/sketchpad5/point-serialization-probe`，不覆盖统一构建。`provenance-point-serialization.json` 记录源码、fixture、实际 exe 与日志哈希。测试程序接收 fixture 目录；可选第二参数写出验证 JSON。测试已登记于统一CMake/manifest构建。

等价范围要求原本有效的可访问缓冲。native-to-native action0 把小 selector 作为 converter 输出地址的输入，以及 action0 保留 selector 返回标量 ECX 作为地址的输入，不满足测试的可访问分配前提；action2 的保留 selector 已以真实缓冲 ECX 覆盖。未覆盖 context 与 payload 相互重叠、typed helper 的重叠 memcpy、未屏蔽浮点异常、完整 FPU/EFLAGS 或原 CRT 的任意 80 位返回值。以上属于明确边界，不代表完整 GSP 读写或整个应用已恢复。
