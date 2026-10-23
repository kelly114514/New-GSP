# 发行包GSP记录读写验证

`tests/gsp_corpus_prepare.py` 按既有 `analysis/gsp-inventory.json` 核验每一个原文件的SHA256，打包1431个互不重复的文件，总59,994,160原字节。独立测试扫描器只计算各记录的raw长度、kind和精确physical长度，检查边界与终止记录；它不是生产parser，没有计入已恢复函数。

实际生产调用由 `gsp_corpus_roundtrip.cpp` 完成：通过真实分页表槽解析type3内存流，`4B98D0`读取magic，`4BA0D0`读取每条记录，`4B9590`写magic，`4B9DF0`写记录，内部直接连接恢复的byte/memory层。读API要求精确physical容量；fixture根据原始字节提供该容量，没有改写为新设计的通用parser。

编译执行通过后验证1431文件、1,907,414次记录读取、1,907,414次记录写入、457处奇数字节补零、2862组EOF/绝对seek行为；每个输出文件全部字节与原文件相同。另逐记录比较raw/kind/payload、position/end/max字段，检查源/目的缓冲canary及真实分页表high_water。测试不调用opaque FILE边界或新分配，因为两侧固定内存及表项已预分配。

该测试是发行件字节对照，不单独计作190万次原机器码差分；原机器码语义由各组件差分和完整稀疏原码保存链交叉验证。保存链已连接对象头与父引用，但本测试不建立真实文档、页面或几何对象；不能据此声明完整GSP加载/保存和Windows应用已恢复。

完整成员路径与SHA见 `tests/gsp_corpus_manifest.json`。fixture身份由生成的头文件绑定，运行前再次BCrypt SHA256检查；其输入与验证结果亦进入统一构建记录及不可变测试日志。
