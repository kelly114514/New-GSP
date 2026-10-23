# 页面字体与样式读取

`page_style_reading.cpp`恢复`00437DB0`字体记录读取、`00437E70`样式记录读取、
`00437FF0`可选对象样式读取与`004EA0B0`字体目录查找。原字节、范围和完整LLVM
Listing由`page_style_reading_extract_fixture.py`核对；REA调用结果保存在
`analysis/sessions/document-envelope/fixup-{load-font,load-style,inline-style,font-register}-*.json`。

字体记录先用真实Windows UTF8转换，再按当前目录使用MSVC `_wcsicmp`查找；未找到
保留字体1，Geneva/Times使用两个显式实时别名槽。不会自动注册系统字体。
字段目录采用`page_style_write.hpp`的100字节行与实时begin/end，保留原版两次不同
时间的范围检查。非空载荷必须在WORD后提供可访问NUL，这是原入口的内存前提。

kind1201追加到实时字体映射表，连续相邻记录一次读完。kind1203逐项写入24字节表行
前20字节，末4字节保持原值；字体索引按入口捕获的字体表high-water检查，再取真实
字体编号。两者假定外层已正确分派首kind与有效长度，不作为损坏文件边界验证器。
kind2008不存在时不改目的和流位置；存在时取表行，按原五DWORD及末WORD顺序复制。
外层须先验证索引属于已加载样式，否则原表ensure可能进入未初始化表行。

31个完整原函数差分比较返回值、全部表/流/缓冲字节和分配计数，覆盖大小写、别名、
UTF8、未知字体、缺失目录、连续记录、映射越界、分配失败、截断、已有sticky错误及
可选对象样式。机器码1068字节只在测试中执行，记录/表实现和Windows转换使用实际
代码，安全cookie与MSVC CRT是明确边界。

另实际从原版`point.gsp`磁盘样本定位字体记录，用恢复函数读出Times New Roman
字体及24点样式，并确认流保留在第一个页面偏好记录10002。该集成没有宣称已读取
页面偏好或整份文档；命令参数使用wmain保持中文目录路径。
