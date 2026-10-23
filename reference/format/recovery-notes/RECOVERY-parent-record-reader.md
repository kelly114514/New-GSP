# 父引用记录读取

`parent_record_reader.cpp` 恢复 `004A8D70..004A8EE7` 的完整原算法，统一寄存器 ABI 为 C++ 参数。生产路径只调用恢复源码，不加载原件机器码。原件为 `analysis/unpacked/GSP5chs.exe`，SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。

## 原调用链和布局

`004A9300` 在约束非零时用本函数读取 kind2002 父引用；可选 kind2003 走同函数的约束附加数据分支。原 ABI 为 EAX=流句柄、EDI=输出句柄，栈参数为 source metadata 四 DWORD、期望记录 kind、父向量标记。来源为 `analysis/sessions/minimal-document-io/load-parents.json` 的完整 Listing，已与原 PE 测试夹具逐指令核对。

函数先清零输出，调用 `004BA220`/`004BA370` 取得原始长度及借用的流缓冲，再核对 kind 和 `u16(raw_length >> 2) * 4 == raw_length`。父引用分支按 `u16(raw_length / 4 - 1)` 分配原生 arena 向量，写 +2 的元素数，再将 serialized 源与 selector=3 的 native 目的交给 `004A7220`。后者实际通过加载映射替换对象 ID；无效 ID 返回39，映射中的空对象返回12。顺序和重复引用不变。arena、映射及 metadata 均按原调用点读取，不能在可能扩容/重入的分配前缓存。

约束附加分支以 selector=4 调用已恢复 `004A73A0`；本模块没有新增成功回调。不支持的 constraint serializer 仍是已有显式未恢复边界，由调用者提供实际实现或在更外层拒绝相应类型。

## 拥有权与限制

读缓冲由流拥有。父引用 arena 向量一旦分配，即写入输出；转换失败时也保留句柄与部分写入，由实际对象读取器负责释放或转交构造器。该函数不补建父对象的反向子边，反向边由 `construct_minimal_loaded_object32` 的真实 `00441920` 路径建立。附加数据转换仅在返回值小于20时提交其目的句柄，与原函数一致。

原函数不验证整个输入域。例如原始长度为零会使父向量容量减法截断为65535；序列化 count 及其指向内容仍须有可访问内存。这些原生前提保留在底层恢复函数中，面向文件的加载器须在准入层限制最小类型和损坏输入，不能把本模块当通用安全解析器。`004A99E0`（旧查询名 `load-fixup`）处理 kind1204 的工具参数表，不能把它的未恢复状态误称普通父边尚未修复或已修复。

## 验证

`parent_record_reader_extract_fixture.py` 从已核验原 PE 提取375字节完整函数，保留哈希和 Listing。`parent_record_reader_differential` 把每个 callee 接到已有恢复生产实现，比较返回值、完整流/缓冲/arena/映射状态、分配次数及输出句柄。21个针对新增路径的场景覆盖空父列表、顺序/重复父引用、大向量引起 arena 搬移、映射零/越界/空对象、部分写入、长度不符、记录种类错误、读缓冲/arena分配失败、截断与 sticky 错误，以及已恢复的 constraint-extra 分支。

独立真实集成使用实际 MSVC 堆和磁盘 FILE：写出 kind2002→重开→加载映射解析父 ID→交给真实最小线段构造器→核对双向父子边→关闭流并释放整页。该集成证明父引用闭包，不代表完整页面或文档加载验收。

独立验证入口：`native/tests/parent_record_reader_build_probe.ps1`。统一构建/CTest 的实际结果以当前构建记录为准。
