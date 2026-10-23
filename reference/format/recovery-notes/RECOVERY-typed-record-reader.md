# Typed记录读取装配

恢复 `004A89C0..004A8A98`（216字节）及 `004A8C60..004A8D6E`
（270字节）两个完整原函数。来源为
`analysis/sessions/minimal-document-io/load-typed-header.json`
（`ev_e1c8dba3e18581fbadc8e11e646f2747510d25ca9b646d25c2226b813815fdfe`）和
`load-typed-payload.json`
（`ev_91671ec99db6f16f3a9157dcfbe64940720afe22977ad9dd6bf8f885cda5ea4b`），
边界、原字节和独立LLVM完整反汇编保存在 `tests/fixtures/typed-record-reader/`。

## 调用与拥有权

二者均依次调用真实 `004BA220` 读取分段头、`004BA370` 取得流拥有的连续载荷，
再建立64字节 `TypedContext32` 并调用指定转换器。生产没有可替换的记录读取
成功回调，没有原PE代码，也不取得流缓冲的拥有权。转换器必须在调用中消费载荷；
不能把借用指针作为对象持久payload保存。空记录时局部payload初值为null，
因此零长度的转换器收到null，而不是流上次的缓冲地址。

`004A89C0` 原ABI为EAX=流、EDI=源metadata，栈参数为转换器、目的指针slot、
预期kind。源为representation 2，目的为representation 1的直接结构地址。
源metadata四DWORD和目的slot均在记录I/O后按原顺序读取；不提前缓存，
故分配或stdio期间的slot改变仍然生效。

`004A8C60` 原ABI为EAX=流、EBX=目的selector，栈参数为转换器、目的bits、
预期kind及备选kind。源metadata来自原 `006B6B9C..006B6BA8` 实时slot，
目的为representation 0。备选kind为0表示禁用；只在selector为0、1或8时
写入目的meta_0c。原函数对其它selector保留未初始化的base，这不是调用者可用的
默认地址。selector 2、5、7虽为底层typed resolver接受的值，却不能在本装配器
中假设具有已设置的base。

两个装配器都设置action=0、advance=0、源raw长度和目的长度FFFFFFFFh。
原函数未初始化的目的metadata不人为补零；转换器必须遵守其所选representation
和selector的有效字段。header转换器不得读取目的metadata；payload转换器
不得读取未设置的base或额外metadata。source的四metadata含义保持由转换器解释。

记录读取仅在头读取恰好返回0时继续payload读取；正数>=20立即返回。
小于等于0的读取状态以0为已有状态；正数<20保留，kind不合时返回39。
转换器返回值与已有状态取有符号最大值。普通有效记录后负数转换状态因此返回0。
记录已被消费，即使kind不匹配或转换器失败也不回滚位置。已有sticky错误、
部分读进度及读取缓冲的分配失败状态由底层真实实现保留。

## 验证与边界

`typed_record_reader_build_probe.ps1` 可在既有静态库上独立编译新模块；
CTest接线名为 `original_typed_record_reader_differential`。
测试执行486字节完整原函数，先核对SHA256后修补四处callee及四处metadata
绝对地址，再只授予执行/读取权限。两个原callee均桥接到恢复的生产记录读取器，
不是返回成功替身。记录经真实注册表、分配策略和内存流创建，测试结束实际堆计数归零。

164组差分比较已初始化context字段、payload内容、转换器次数、返回状态、
流位置/sticky错误及目的字节。覆盖空/奇数/普通长度、匹配/不匹配kind、备选kind、
目的selector、负数及warning/fatal转换结果、头/载荷截断、已有错误、真实分配失败，
以及分配期间改变源metadata和目的slot。generic测试转换器是明确观察边界，
不作为应用功能完成的证据。

另将实际 `0043D190→0043CD70` header转换与
`00445F30→00445EE0→00445E10` 点转换接入真实记录I/O，
检验解码kind、binary64坐标和四个坐标缓存，全部缓冲/注册表释放归零。
该组合使用显式MSVC宿主floor/integer适配，输入限普通有限坐标；
不宣称恢复原静态CRT的全部数值异常语义。

本模块关闭了 `004A9300` 的这两个typed装配依赖；完整对象记录循环、
父向量读取、load-map填入与引用修复、其它类型converter以及文档外层仍需各自实现。
它不等于恢复版已能打开整个真实GSP。
