# UTF-16 换行规范化（004B70C0）

`text_newlines.cpp` 恢复原函数 `004B70C0..004B717C`（含末尾 `retl`，排他上界 `004B717D`，共 189 字节）。
函数把 UTF-16 字符串中的 CR、LF、CRLF 统一为 CRLF，并用 CRT `_malloc` 分配新缓冲。

## 原码布局与来源

- Ghidra 函数体为 `4B70C0..4B7109` 与 `4B7110..4B717C`。`4B710A..4B710F` 为 6 字节
  `lea (%ebx),%ebx` 对齐填充：只由 `4B7108` 的 `jmp` 跨过，从不执行，恢复时计入字节范围。
- 原字节与完整 LLVM Listing 由 `tests/text_newlines_extract_fixture.py` 从
  `analysis/unpacked/GSP5chs.exe`（SHA-256 `de41b856...64e7a`）抽取并核对；Listing 在
  `tests/fixtures/text-newlines/original.asm`。
- Ghidra 伪代码（`analysis/sessions/read-path-leaves/README.md`）只作线索。其返回类型标为 void，
  实际返回值在 EAX，见下。
- CRLF 常量 `0x00655E4C`（`.rdata`，字节 `0D 0A 00`）由抽取脚本从 PE 取出并校验。代码在
  `004B7142` 以 `movl $0x655e4c,%edx` 取址（imm32 位于 `004B7143`）。`0x655E4C` 本身不被读取，
  首个 CR 由立即数 `0x0D` 写出，之后才读 `0x655E4D`（LF）与 `0x655E4E`（NUL）。
- 唯一越界调用为 `004B70F3` 的 `call 0x5EDF0B`（CRT `_malloc`，cdecl，一个栈参数）。

## ABI

- 输入：EAX 为非空、NUL 结尾的 UTF-16 字符串指针。
- 输出：EAX 为新缓冲指针；`_malloc` 失败时为 0，且不写任何输出。
- 无栈参数，`retl` 返回。EBX、ESI、EDI 按各路径的 push/pop 配对保留；ECX、EDX 与标志位被改写，
  EDX 残留常量地址。调用者不得依赖这些寄存器的值。
- 调用者已核对（只读调用点）：
  - `00450BB9`：`mov eax,esi; call 4B70C0; mov esi,eax`，随后检查 NULL，非空时 `_free`。
  - `004A9EE2`：以 esi 为源调用，结果直接存入 `[ecx+0x5bc]`，未在此检查 NULL；随后释放 esi 源缓冲。

## 算法

与原码逐条对应：

1. 计数：扫描到 NUL。CR 后紧跟 LF 时整体消耗 2 个码元、输出 2 个单位；单独的 CR 消耗 1 个、输出 2 个；
   单独的 LF 消耗 1 个、输出 2 个；其他码元输出 1 个。
2. 分配：请求 `2*units+2` 字节，按 32 位无符号运算（与原 `leal 0x2(%edx,%edx)` 相同）。
3. 写出：按同样分支写 CRLF 或原码元（16 位比较），最后写一个 NUL 码元。

所有比较都是 16 位码元。例如 `0x0D0A`、`0x0A0D` 是普通字符，不被视为换行。

## 错误路径

- `_malloc` 返回 NULL：函数返回 NULL，不写输出，源字符串不被修改。
- 源指针为 NULL：原函数会崩溃，恢复版前置条件相同，未做额外检查。
- 输出字节数超过 32 位时的回绕不受保护，与原 `leal` 一致。

## 适配与替身

- 生产实现使用项目的 `AllocationEnvironment32::malloc_005EDF0B` 边界（由 `host_allocation_environment32`
  绑定 `std::malloc`），不调用原 EXE 的 `_malloc`。它直接调用 malloc，不使用 `FUN_0043CB30` 的保留池重试，
  与原码一致。
- CRLF 常量在生产代码中写为字面量 `0x0D`、`0x0A`，等同于 PE 中的 `0D 0A 00`。原码的 `.rdata` 取址在
  生产代码中不存在。
- 测试替身（只在 `tests/text_newlines_differential.cpp`）：
  - `malloc_bridge` 替代原 `call 0x5EDF0B`，记录每次请求大小，可注入 NULL，并在块尾放置 64 字节 `0xCC`
    保护区以检测越界写。
  - 常量地址通过 `operands` 重定位到测试内存中的同字节副本。
  - 生产侧的 `realloc`/`free` 桩在调用时抛异常，用于证明该函数不调用它们。预留槽为 `nullptr`，因为该函数不使用。
  - `invoke_original` 是 naked 调用包装器，只用于 ABI 桥接，并检查 EBX、ESI、EDI 是否被原码保留。

## 测试范围

差分测试原码与恢复版，比较每个输入的以下内容：

- 返回是否为 NULL。
- `_malloc` 请求序列：恰好一次，大小 `2*units+2`。
- 输出缓冲全部 `2*units+2` 字节，与独立的参考实现比较。
- 保护区未被写。
- 源串未被修改。
- EBX、ESI、EDI 保留。

输入覆盖：空串，无换行，单独 CR、LF，CRLF、LFCR，连续 CR、CR CR，结尾 CR，混合换行，
`0x0D0A`/`0x0A0D`/`0x010D` 等高字节为 CR/LF 的非 ASCII 码元，全 CR、全 LF、大量 CRLF 的长串，
以及确定性随机串（短串与长串）。每个输入都分别跑正常分配与分配失败两种模式。

## 限制

- ECX、EDX 与标志位不比较，恢复版也不模拟其残留值。
- 原函数在 null 源上崩溃，恢复版不提供安全返回。
- 只验证了上述调用者的只读分析，调用者 `00450BB9`、`004A9EE2` 的完整行为未在此模块内测试。
- 它只处理 UTF-16 换行规范化，不包括调用链中的其他转换函数。
