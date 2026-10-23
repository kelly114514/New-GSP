# 页内标签计数记录

`004A7750` 已接入恢复的 `004A7430`、`0040E440` 和实际转换器，不再需要未恢复的页成员 callback。它写页面 `+2A0` 起的标签计数，不能代替完整页写出。

原件 `analysis/unpacked/GSP5chs.exe` 的 SHA-256 为 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。新 REA 证据在 `analysis/sessions/document-envelope/pagewrite-*.json`；页成员写出原证据在 `analysis/sessions/minimal-document-io/page-members.json`。

- `00460360/004603F0` 把原生三 DWORD 的计数行转换为六字节记录：前两项截断为 WORD，第三个 WORD 写零；读取把第三个原生 DWORD 设为一。
- `004601D0/00460310` 保留旧格式的十三行和原生索引表 `0064F238`，第十一项映射到原生索引二十。读入先快照全部 78 字节；若任何首项大于 `0200` 或次项大于 `8000`，返回零且完全保留原生计数，即使输入长度有多余字节。
- 两个 typed wrapper 原本把交换 scratch 设为零。接口没有虚构 action 2 缓冲；实际读写路径使用 action 0/1。旧 wrapper 原生大小 `9C` 与转换器访问的 21 项完整布局不同，这是原版行为。
- `004A7750` 在 metadata[2] 为一时写单件 `04B0` 旧记录；其它格式按原 kind 表写 `0960+kind` 与末项 `095F`。本层吞掉小于二十的警告，出现错误立即停止。

`page_member_transfer_extract_fixture.py` 根据原件哈希、完整 LLVM 指令边界及 REA 原件身份生成仅测试使用的五段 oracle。生产源码不含机器码。差分比较返回值、全部目的缓冲和 typed context、实际 record writer 产生的完整记录序列。独立 probe 的 MSVC x86 `/W4 /WX /O2 /fp:strict` 验证通过：126 项转换、104 项 typed、36 项写出场景；包含短/长记录、旧格式无效值、窄化、原生/序列化表示和记录错误停止。

构建接线：将 `native/src/page_member_transfer.cpp` 加入静态库，新增 `original_page_member_transfer_differential`，源为 `native/tests/page_member_transfer_differential.cpp`，链接静态库与 `bcrypt`，参数为 `native/tests`。完整构建还须运行 fixture 提取并把新增来源与夹具绑定到构建记录。独立 probe 在 `native/tests/page_member_transfer_build_probe.ps1`，不代替集成构建记录。
