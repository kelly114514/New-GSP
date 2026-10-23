# 字节字符串转换与写出

`string_transfer.cpp`恢复完整`004A7590..004A75CA`、`004A8050..004A806F`
与`004A8070..004A80E7`。目标身份和每段SHA-256由
`tests/string_transfer_extract_fixture.py`从解包中文主程序核对，完整LLVM Listing
在`tests/fixtures/string-transfer/original.asm`。`004A8070`及`004A8050`在Ghidra
数据库中不是独立procedure，失败查询不能当作反编译证据；恢复依据是哈希绑定原字节
与完整Listing。`analysis/sessions/document-envelope/string-write-raw.json`
保留了原写出包装器查询。

原包装器ABI是ECX=字符串、EDX=记录kind，栈参数为handle与metadata，不能按
反编译漏掉的寄存器参数猜测。它建立selector7的原生字符串源，调用真实两遍typed
writer。测量与复制都由同一个真实转换器完成；记录sink仍须提供实际I/O。

typed转换器先从原生`meta_0C`或直接源地址扫描NUL，再检查serialized长度。
序列化长度为`(strlen+2)&~1`，原生长度再向4字节取整；小于最小长度返回39，
较长serialized源返回4。其扫描在长度检查前完成，调用者必须提供可访问NUL，
不能把此入口当作不可信载荷的边界检查器。action2传null scratch，保留原生
不支持交换的前提。action0/1/其它action及指针advance由真实`0040E440`处理。

底层converter逐字节复制到含NUL为止，不能改成复制四舍五入后的全部长度。
NUL后补齐字节不写，保留调用者scratch的原值；这解释了不能仅凭整个字符串记录
逐字节差异认定语义差异。测试精确比较这些字节，未通过忽略规则掩盖。

55个原函数差分执行208字节完整原码，转换和writer依赖均接真实恢复实现；比较空串、
奇偶长度、构建来源、UTF8字节、测量/转换/非执行action、短serialized长度、指针
advance及完整输出记录。generic记录sink只是明确的观察边界，不代表整页写出。

此模块处理已编码字节，不声称恢复`004A7620`的UTF16转码及其静态CRT编码表。
