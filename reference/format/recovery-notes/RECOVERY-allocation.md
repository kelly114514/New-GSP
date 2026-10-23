# 原分配器压力回退恢复

目标为固定 SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a` 的 `analysis/unpacked/GSP5chs.exe`。生产源码只有两条原包装函数的恢复；原 CRT 堆管理器、备用内存初始化/补充/最终释放不属于本单元。

## 来源与完整性

| 函数 | 原 ABI | 完整 PE 范围 | 原 REA Evidence |
|---|---|---|---|
| `0043CB30` | EBX=bytes，栈+4=tag，EAX=pointer | `0043CB30..0043CBC0`，145 B | `ev_c0aa64c028e34eca9406c0b0604e23546c43112d101a1d55e4132e1ac31e2b00` |
| `0043CBE0` | EDI=pointer-slot，EBX=bytes，EAX=allow-pressure；返回 EAX=0/1 | `0043CBE0..0043CC60`，129 B | `ev_a6f8fdeb017531ed5fd73f6d65bc39523014fba5788950329044a8d669da29f1` |

证据来自 `analysis/recovery-pass2/allocator-boundary.json`、`reallocator-boundary.json`。旧 Ghidra 将 `_free` 误标为 no-return，body 仅收录106/82字节；反编译缺失39/47字节及关键后继。`tests/allocation_extract_fixture.py` 校验原 PE SHA，通过节表提取完整连续范围，再使用本机 llvm-objdump 逐指令核对全部原字节。完整 listing、每个 CALL、全局操作数与原 REA body 限制存于 `tests/allocation-original*`，没有把补全 listing 冒称新的 REA Evidence。

## 恢复语义

- `43CB30` 首先调用真实边界 malloc。成功时仅在 tag 低字节 bit2 置位时清零 bytes 个字节，不接触备用槽。初次失败后才缓存 `6B6610/6B660C`；bit7 禁止释放。允许压力回退时先释放缓存的6610，再释放660C，每释放一个就重试 malloc；成功或耗尽才写回缓存。重试期间全局槽可以仍指向已经交给 free 的旧值，不能提前清零或每轮重读替换缓存。
- `43CBE0` 每次 realloc 都重新读取 `*allocation`。首次失败后只缓存660C，allow-pressure 的全部32位按非零判断。每轮重新读取6610；释放6610后立即清零全局6610，再重试。释放660C只清本地缓存，最终写回。重试成功先写回660C，再提交输出指针，因此输出指针槽与备用槽重叠时顺序可见。没有分配器包装层的清零行为。
- 长度参数为完整32位，不加 signed 检查，也不把零长度转为特殊成功。CRT realloc 返回空时函数返回失败且不会自行清空输出，即使 CRT 的零长度路径已经释放旧块。
- 源接口将寄存器 ABI 正规化为 C++ 参数。`AllocationEnvironment32` 显式提供 malloc `5EDF0B`、realloc `5EED42`、free `5EDDB9` 与两个全局槽；memset `5F69A0` 的有效内存语义由 `std::memset` 实现。无成功 stub，无默认 CRT 假实现。

## 实际验证

`tests/allocation_build_probe.ps1` 使用 MSVC Win32/x86、C++17、`/O2 /W4 /WX /MT /fp:strict`。独立运行 `allocation_differential.exe <native/tests>`：**58,080组、0差异**（allocate 23,280、reallocate 34,560、binding 240），日志为 `tests/allocation_build_probe.log`。完整集成构建状态由根构建另行登记。

原码 oracle 只装载上述274字节；装载前核对硬编码 SHA-256，重定位9个外部CALL和11个全局操作数，内部跳转原字节保持，改为RX后调用。未执行PE入口，生产库不含原机器码。两侧使用同一确定性故障注入边界，比较全部1024字节测试arena、调用序列/参数/返回、每次边界所见备用槽/输出槽、最终返回值与指针。边界记录实际成功、失败和副作用，不以成功stub跳过压力路径。

场景覆盖全部256种低字节tag、额外高位tag、0/1/31/256及高位长度、四种备用组合、首/次/第三次成功与持续失败、malloc/realloc/free期间一次性改写备用槽、重分配输出槽与两备用槽分别alias、空旧指针，以及CRT零长度释放但返回空的显式模拟。

未证明原CRT分配内部、真实低内存系统状态、非法指针/越界内存、异步线程竞争或无限补充备用池的行为。大长度场景由CRT边界失败，不声称实际分配了对应大小。测试覆盖有限输入，不能外推整个CRT或完整程序已恢复。

## 集成

生产加入 `src/allocation.cpp`；测试加入 `tests/allocation_differential.cpp`，链接恢复库和bcrypt，参数为tests目录。测试名建议 `original_allocation_differential`，测量键 `allocation_cases=58080`。生产无原机器码依赖。现有 `BlockTableAllocator` 的回调签名可通过显式适配调用这两条恢复函数；备用池提供者及CRT边界必须继续明确，不能将本单元完成写成整个分配生命周期闭环。

绑定接口 `bind_allocation_environment(AllocationEnvironment32&)` 返回借用环境的 `BlockTableAllocator`；环境与两个备用槽必须活过回调视图。新增240组table创建、ensure、扩容、销毁对照：两侧使用相同已恢复table代码，原码allocator callbacks与生产binding分别驱动；比较完整arena、分配/释放事件、返回及备用槽。验证tag0/4与压力禁止位，不把table源码共享部分重复算成新的原码恢复。
