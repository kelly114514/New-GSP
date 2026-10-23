# 分配记录读取（转换器两遍）

恢复 `004A87D0` 完整原函数，原字节范围 `004A87D0..004A893E`，排他上界 `004A893F`，
共 367 字节。范围含 Ghidra 函数体外的间隙 `004A892D..004A8935`（`addl $4,%esp`
与 `movl $0,(%esi)`）。来源：`analysis/unpacked/GSP5chs.exe`（SHA-256
`de41b856…64e7a`），字节与 `llvm-objdump` Listing 保存在
`tests/fixtures/allocated-record-reader/`。Ghidra 伪代码只作线索，`_free` 被误标为
no-return，真实尾部以 Listing 为准：free 之后清零 `*param_2` 并返回 EBP。

## ABI

- 输入：EAX=流句柄，EDI=四个 DWORD 的 metadata 指针；栈（cdecl，调用者清理）为
  `converter`、`destination_slot`（指向 `void*` 的指针）、`expected_kind`、
  `optional_bytes_out`（可为 null）。
- 输出：EAX 为有符号状态；`*destination_slot` 在读取前清零。
- 调用者：`004A9C80` 分派表内 `004A9D11`（已由 Listing 核实参数压栈顺序）。该点
  `EAX=EDI`（句柄，`004A9D08`），`EDI=EBX`（metadata，`004A9D0F`），栈为
  converter `0x4A8070`（字面压栈）、`destination_slot=基址+0x56C` 的地址、
  `expected_kind=ESI`（调用前的值，其来源本批未追溯）、`optional=0`。同函数其它调用点
  `004A8969`、`004A90D3`、`004A9E91` 本批未逐一分析，不写入结论。
- 被调用者：`004BA220`（ESI=句柄，栈 kind/raw/physical 三个输出指针，physical
  为必需）、`004BA370`（ESI=physical，栈 handle 与 payload 输出指针，流拥有 +10
  缓冲的借用视图）、`0043CB30`（EBX=字节数，栈 tag=0，分配环境）、`005EDDB9`
  （cdecl 单指针，经 `AllocationEnvironment32::free_005EDDB9` 释放）。两个转换器调用
  为 `calll *%esi`，cdecl，参数为一个 `TypedContext32*`。

## 栈上 TypedContext32 与局部布局

以入口后栈指针 S 表示。局部：S+10 payload（初值 0）、S+14 physical 长度、
S+18 kind、S+1C raw 长度。`TypedContext32` 位于 S+20..S+60：

| 偏移 | 字段 | 第一遍 | 第二遍 |
|---|---|---|---|
| S+20 | action | 1 | 0 |
| S+24 | advance | 0 | 不变 |
| S+28 | source.rep | 2 | 不变 |
| S+2C | source.bytes | raw | 不变（转换器可改） |
| S+30 | source.data | payload | payload 重写 |
| S+34/38/3C/40 | source.meta 0C/10/14, version | m0,m1,m2,m3 | 不变 |
| S+44 | destination.rep | 1 | 不变 |
| S+48 | destination.bytes | 0xFFFFFFFF，转换器写测量字节数 | 不变 |
| S+4C | destination.data | 未写（原栈残留） | 分配块 |
| S+50/54/58/5C | destination.meta 0C/10/14, version | m0,m1,m2,m3 | 不变 |

第一遍之后再把 destination.data 写为分配块、action 写为 0，同一上下文再次传给
转换器；因此第一遍写的字段对第二遍可见。metadata 只在两遍之前从 EDI 读取一次，
分配或流操作期间修改 EDI 所指内容不影响本函数。

## 控制流

1. `*destination_slot=0`；`*optional_bytes_out=0`（若非 null）。
2. `004BA220(句柄,&kind,&raw,&physical)`；若返回 0，再 `004BA370(physical,句柄,&payload)`。
   状态 `status=max(读取结果,0)`。
3. 读取结果 `>=0x14` 直接返回该值，不分配、不调用转换器。
4. `kind != expected_kind` 且 `status < 0x27` 返回 `0x27`。
   （`status >= 0x27` 的分支在此不可达：到此处的 status 已小于 0x14。）
5. 第一遍转换器；其返回值与 status 取有符号最大值；若 `>=0x14` 直接返回（未分配）。
6. `block = 0043CB30(第一遍写的 destination.bytes, tag 0)`，无论成功与否都保存到
   `*destination_slot`。分配失败返回 `0x64`（原码 `leal 0x64(%eax),%ebp`）。
7. 第二遍转换器；status 再取最大值。
8. 若 status `<0x14`：写 `*optional_bytes_out = destination.bytes`；若 status 不为
   `0x0C` 直接返回 status，块保留给调用者。
9. 其它情况（status `>=0x14`，或 status 为 `0x0C`）调用 `free(*destination_slot)`，
   清零 `*destination_slot`，返回 status。

因此：块仅在最终 status 为 0..0x13 且不为 0x0C 时保留；`0x0C` 与所有 `>=0x14`
错误都释放。

## 实现与适配

- 实现位于 `src/allocated_record_reader.cpp`，声明在 `include/gsp/allocated_record_reader.hpp`。
  调用 `FUN_004BA220`、`FUN_004BA370`、`FUN_0043CB30`，释放经 `AllocationEnvironment32`，
  没有可替换的成功回调，也不调用原 EXE/JAR。
- 适配 1：局部 `kind/raw/physical` 与 `TypedContext32` 在生产中零初始化。原码在
  `004BA220` 失败前不写输出，其栈内容未定义。
- 适配 2：生产中第一遍 `destination.data` 为 0（原为未写的栈残留）；转换器第一遍不得读取它。
- 适配 3：转换器以显式 `converter_user` 参数接收，原为 cdecl(ctx)。

## 测试替身（仅测试 oracle）

`tests/allocated_record_reader_differential.cpp`，原字节在 `VirtualAlloc` 的可执行页中运行：

- 原 `004BA220` 调用经 `header_abi` 转发到恢复的 `FUN_004BA220`；转发前桩将三个输出清零，
  与生产的零初始化对齐。这是本测试唯一的输出预置，不改变被测语义。
- 原 `004BA370` 经 `payload_abi` 转发到恢复的 `FUN_004BA370`。
- 原 `0043CB30` 经 `alloc_abi`（EBX=字节数、栈 tag）转发到恢复的 `FUN_0043CB30`，
  使用同一测试堆，并记录分配/释放事件。
- 原 `005EDDB9` 直接指向 `free_read`（测试堆释放，记录事件）。
- 两个 `calll *%esi` 转换器为测试的 cdecl 观察器，与恢复版共用同一逻辑。
- 原函数的 `call_original` 桩设置 EAX、EDI、栈参数并保存 EDI。

比较项：返回值、两遍的上下文字段（不含第一遍未写的 destination.data）、转换器调用数、
`destination.data` 是否为非空、payload 相对流缓冲的偏移、`*destination_slot` 是否为 null、
保留块的前 `min(16, 测量字节)` 字节、可选输出值、分配/释放事件序列、流错误与位置、
堆释放。

覆盖：

- kind 匹配与不匹配；raw 0/16/79；测量字节 0/16；
- 两遍转换器状态 `{-5,0,4,0x0C,0x13,0x14,0x26,0x27}` 的全组合；
- 可选输出为 null 的组合；
- 第 1 或第 2 次分配失败（第一次为流记录缓冲，第二次为本函数块）；
- 截断 `{1,4,7,8,10,23}` 与流错误 `{-5,0x13,0x14,0x19,0x27}`。

## 验证

- 夹具：`allocated_record_reader_extract_fixture.py` 按 SHA-256 核对原件，写出 367 字节原字节、
  Listing 与四个调用的重定向表（原 `004BA220`、`004BA370`、`0043CB30`、`005EDDB9`）。
- 差分：`original_allocated_record_reader_differential` 单独运行输出
  `allocated_record_reader differential PASS: 886 cases`，退出码 0。
- 完整构建 `recovered/build-native.ps1`：全部 extractor 身份检查通过；CTest 共 50 项，
  其中 49 项通过。唯一失败为 `recovery_java_record_guards`，原因是本检出缺少未入库的
  `recovered/java/build/java-build.json`，且 `java/build.ps1` 报告
  `recovered/java/src/GSP.java` 与 provenance 的 SHA-256 不一致（工作区版本
  `53be…`，provenance 为 `5e70…`）。该项属于 Java 车道，与本模块无关，未修改。
  因构建脚本在 CTest 阶段失败，未生成本次构建记录。

## 限制

- 只恢复 `004A87D0`，未恢复 `004A9C80` 的页面记录解释，也未恢复 `004A8969`、
  `004A90D3`、`004A9E91` 等其它调用点的上层行为。
- 原码读取失败时的栈残留不可复现；生产以零代替，测试以清零桩对齐两边。
- `status >= 0x27` 的 kind 不匹配分支在原码中不可达，未单独构造测试。
- 转换器的具体语义不在本模块内，测试转换器只观察和写入约定字段。
- 不包含流打开、页面或对象语义的完整读取。
