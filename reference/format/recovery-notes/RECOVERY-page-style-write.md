# 页字体与样式写出

已恢复 `004E9F30` 字体记录生成和 `00437BB0` 页字体/样式写出，使用真实 Windows UTF-8 API、恢复分配策略、block table、记录和字节流。生产源码不执行原件。它们提供页保存必要依赖，不代表完整页/文档保存已经完成。

来源为 SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a` 的 `analysis/unpacked/GSP5chs.exe`。`004E9F30` 的完整 REA 反汇编及伪代码在 `analysis/sessions/document-envelope/pagewrite-font-serialize-{asm,c}.json`，`00437BB0` 在 `analysis/sessions/minimal-document-io/page-style-write.{asm,json}`。原 CRT invalid-parameter-noinfo 的识别证据为 `pagewrite-vector-range-error*.json`，使用当前宿主 CRT 的显式适配入口 `host_font_invalid_parameter32`；不声称恢复原 MSVC CRT 内部处理器。

字体目录每行 100 字节，`+00` 为 UTF-16 face，`+42` 为记录首 WORD，其他字段保留未知。字体序号先截断为有符号 WORD，超过目录末项返回零；小于一时钳制为第一项。第二次边界检查失败调用 CRT invalid-parameter，再重新读取目录基址。接口保留这两个实际 live slots，不能用测试固定返回替代真实目录。

字体转换调用 `WideCharToMultiByte(CP_UTF8,0,face,-1,...)`，返回 UTF-8 字节数（含 NUL）加四。实际只写首 WORD 和 UTF-8 字符串，尾部两字节仍为旧缓冲内容；按偶数向上取整后还可能多一字节。原版基准 `point.gsp` 的 Times New Roman 字体记录尾部亦有非零残留。该事实限制字节确定性；不能把字符串外的整件记录都忽略，也不能把未知尾部误当字体字段。

`00437BB0` 按页字体表写 `04B1`，复用动态缓冲，不足时先释放再按所需偶数长度加十字节分配。字体阶段错误非零会退出该阶段；只要 metadata[3]>=4，仍进入样式阶段，后续样式记录状态会覆盖先前字体状态，这是原行为。样式阶段先将每行 WORD[11] 写回 WORD[0]，再写前十 WORD 为 `04B3`，WORD[10] 不进入记录。分配失败返回 100，流错误由恢复字节流保留。

原机器码夹具仅在 `tests/fixtures/page-style-write`，提取脚本核验原件哈希、完整 LLVM 解码和 REA 身份。独立 probe 使用 MSVC x86 `/W4 /WX /O2 /fp:strict`：16 项字体、18 项写出差分通过。字体含默认字形、中英文、代理对、序号截断及超界；写出使用真实 block table 和内存流，比较完整记录字节（含预置分配内容的原版未写尾部）、全部样式行副作用、分配/释放数和分配失败。没有成功替身式字体/记录 callback。

接线：静态库新增 `native/src/page_style_write.cpp`，CTest `original_page_style_write_differential` 源为 `native/tests/page_style_write_differential.cpp`、链接静态库和 `bcrypt`、参数 `native/tests`；构建运行 `page_style_write_extract_fixture.py` 并绑定 provenance。`page_style_write_build_probe.ps1` 是独立验证入口，不能代替统一构建。完整字体注册与页保存外层仍由总计划跟踪；最小默认字体目录的内部 ID 必须与创建页面使用的目录一致。
