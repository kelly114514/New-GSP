# 约束额外记录与一个真实payload闭包

目标为固定SHA-256的中文解包PE
`de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。

恢复4个原函数：`004A73A0`（130B）、`0040E720`（737B）、`0040E6D0`（79B）、`00422DD0`（29B）。生产源码没有原函数机器码；原约束、genera及逆映射表以整数原始数据保留。

## 来源与完整性

分发器来源`analysis/recovery-pass6/constraint-extra-transfer.json`，Evidence `ev_f57d0888f4694d678ca17b9500d44eca3414c164d6a26db384c10f0d4d00dc68`。
通用payload来源`analysis/recovery-pass9/constraint-payload-transfer.json`，Evidence `ev_2e02894d12356be834c3c2b26e7ccad54c29bba5d5e880cb2c2efa5432871e51`。
两个短入口REA报告未识别函数，错误原样保存在pass9；采用固定PE的完整LLVM Listing和独立提取哈希补证，没有伪造Evidence ID。选择依据见下节。

`tests/constraint_extra_extract_fixture.py`逐条核对Listing字节、CALL、全局/表项和尾RET，生成4个函数及4张表的fixture。`tests/fixtures/constraint-extra/fixtures.json`记录完整地址/长度/原字节身份。

## payload选择依据

123行约束表的`+0x20`共有18个不同非零serializer：`0048BB40`、`00422C90`、`00422CB0`、`00422CD0`、`00422CF0`、`00422D10`、`00422D30`、`00422D50`、`00422D70`、`00422D90`、`00422DB0`、`00422DD0`、`00403A70`、`00422DF0`、`004C7240`、`00422E10`、`00422E50`、`00422E30`。表关系可复核于`analysis/recovery-object-dispatch.json`及本模块fixture。

`00422DD0`被行60–65、78、79、82、83、111、113共用。其29字节包装器以native/serialized大小8/8、selector0调用`0040E720`和`0040E6D0`，形成可独立核对的8字节组传输闭包，包含对象+B4 arena分配与失败路径。

其它入口不据此视为已恢复：`00422C90`至`00422DB0`的10个包装器依赖更大的`004C7830`描述符解释器；`00403A70`涉及额外父引用/类型和临时向量拥有权；`0048BB40`有二级动态分派；`00422DF0/00422E10/00422E30/00422E50/004C7240`可能共享通用转移，但各自行为仍需验证。这些是选择范围和证据限制，实施顺序只见[总计划](../PLAN.md)。

## 保留的原行为

- 分发器按representation解析内部索引或外部ID；旧布局读取signed byte，representation2拒绝ID>=128、sentinel124或空回调；返回只保留正状态。非法native索引仍为原调用方前置条件。
- 通用转移在action1仅量测；其它action按原路径处理。native payload从对象+B4短句柄取得；selector1涉及父对象genera。紧凑旧头、约束与genera双向映射、原4字节头和方向选择均保留。
- native目标通过真实恢复`004D5670`分配arena区域并提交短计数；大小截断、warning4、100/101错误和副作用按原顺序。源arena在原读取点快照，目标在分配后重读槽，保留原指针/移动边界。
- `0040E6D0`拷贝`8 * u16(bytes >> 3)`字节；原CRT memcpy依然是显式回调依赖。不能以当前测试边界推导原CRT重叠/volatile行为已恢复。
- `00422DD0`调用真实通用转移与8B converter，采用8/8字节大小、selector0。它是18个不同额外serializer中的1个；其余17个必须由明确外部回调处理，没有默认成功实现。

## 验证

独立probe与统一CTest执行固定哈希原码：分发6952、通用payload29172、真实serializer1728、copy converter40组差分，另64组真实arena保存/读回。比较完整context、对象、父对象、两个arena区域、缓冲、指针槽、返回和有序分配/复制事件。

Oracle在一个统一VA delta中装入本闭包和已恢复arena函数，原函数间CALL保持原字节；仅显式分配、释放和CRT copy边界跳转到测试适配。稀疏范围内没有加载的原callee不能仅因地址位于范围中就视为内部实现。装载器按明确的片段和callee集合判定边界。

支持域涵盖representation0/1/2、不同action/布局、尺寸和selector、扩容/失败、ID/空回调及正负状态。非法指针/索引、任意并发、其它17个真实类型和整页面解析未验证。

`serialization_integration`另外验证864组对象→typed writer→真实constraint-extra→record/byte/memory链，含实际2003记录及失败/arena移动。64次读取往返验证的是payload表示与arena，不是尚未恢复的完整对象读取器。
