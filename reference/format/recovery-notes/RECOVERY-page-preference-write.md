# 页面偏好写出

`page_preference_write.cpp`恢复完整`00493D40..004943F3`与按序拷贝十WORD的
`00437550..0043759F`。目标为解包中文发行版，原字节与SHA-256见
`tests/fixtures/page-preference-write/original.json`。REA完整查询在
`analysis/sessions/document-envelope/pagewrite-page-preferences.json`及
`pagewrite-pref-style-pack.json`；不从保存结果逆推读取算法。

输入是页面`+0C`的FC字节偏好块。写出36条记录：六个布尔、十五个COLORREF、
条件/单位/精度字段及六组默认style与字体。数据来自原生字段，字体通过已恢复
`004E9F30`及实际Windows UTF8转换生成。多数记录非零返回后会按原分支重试
同一记录一次并返回第二次结果；不会概括改成通用重试或累计最大值。

原函数0x128字节栈残留是显式`PagePreferenceWriteScratch32`输入。style记录中
索引后的reserved WORD和字体之后额外尾字节没有被原函数写入，仍保留这些位置
的scratch内容。默认清零是声明的宿主适配，不是恢复出的原版默认字节；没有忽略
整条记录。更改这些未定义字节不会被用来解释其它有定义字段差异。

差分执行1794字节完整原码，原码将同一scratch seed放进真实将用到的栈帧，再调用
真实字体转换与记录I/O。9组必要场景比较全部输出缓冲、流位置/长度/sticky错误，
涵盖真实资源默认偏好、布尔正常化、负数与高WORD、三组精度、不同栈残留，以及
写头和写到中途时真实有界流失败。每个成功场景确认原路径写出36条记录。
未替换应用逻辑callee；测试只归一化编译器安全cookie检查。

此模块消除现代最小页保存的偏好写出依赖；偏好读取、完整页serializer和文档容器
仍需单独贯通和验收。
