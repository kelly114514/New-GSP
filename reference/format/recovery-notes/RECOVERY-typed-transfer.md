# 原 typed transfer 与地址解析恢复

本模块按真实Listing恢复`0x0040E440`和它实际调用的`0x0040E130`。复用`object_header.hpp`中的64字节`TypedContext32`和28字节`TypedEndpoint32`，没有重建替代格式或用“返回成功”的resolver桩替代representation0。

## 来源与可编译边界

源目标为`analysis/unpacked/GSP5chs.exe`，x86，ImageBase`0x00400000`，SHA-256：

`de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`

| 原函数 | 证据 | Evidence ID |
|---|---|---|
| `0x0040E440` | `analysis/recovery-pass3/typed-context-helper.json`完整Listing | `ev_cb0ea93dc1474040103c5c58b52cb9aa0ae58b34269e88a485470f117df0c5a2` |
| `0x0040E130` | `analysis/recovery-pass4/typed-address-resolver.json`，根代理唯一REA会话生成 | `ev_74155cbfff09f7536fc0b34786dab14b681e03fa3a5b14e55fb3d8ff8a0280fa` |

本模块自身未开启REA。另从同SHA PE以LLVM objdump只读反汇编精确范围，保存`tests/typed_transfer-*.disasm.txt`，作为原字节与Listing的交叉核对，没有编造新Evidence ID。

resolver代码范围`[0x0040E130,0x0040E151)`为33字节，随后3字节padding，8项switch jump表位于`[0x0040E154,0x0040E174)`。完整测试fixture为68字节；不把表字节伪称为指令或更多函数。resolver没有更下级callee。

生产helper仅依赖真实resolver、标准memcpy操作以及调用者明确提供的converter。原CRT memcpy在`0x005FB600`；此模块没有恢复该CRT函数的CPU路径、重叠复制或偶然寄存器状态。

## 真实内存描述与ABI

representation0时，端点`+8`不是可进一步解引用的“指向handle的指针”。它是32位selector载体；`+0x0C`保存基值。字段名`data_08/meta_0c`因其它representation的用途而保留，公共头亦提供别名。这里不能把selector3都解释成普通对象地址或套入另一函数使用的短handle规则。

`0x0040E130`原输入为EAX=端点地址、EDX=对象偏移、ECX=回退值；它保留原ECX。源API显式接收这三个值，返回地址位模式：

| selector | 原操作 |
|---|---|
| 0、1 | `endpoint[+0x0C] + EDX`，32位加法 |
| 2、5、7 | 直接返回`endpoint[+0x0C]` |
| 3、4、6，以及unsigned>7 | 返回进入resolver时ECX，不另读内存 |

`0x0040E440`的真实输入为ESI=context、EBX=对象偏移，四个stack参数依次是swap scratch、native字节数、serialized字节数、converter地址。原converter一直获得四个cdecl参数`(destination,source,read_serialized,serialized_endpoint)`；伪代码中部分二参数调用是漏参，不能照抄。源接口归一化为cdecl，并以`TypedConverter32 {user,callback}`把环境指针显式传给converter，不使用生产全局adapter。

## 保留的控制流

- action0：source representation0/1时，特定原生拷贝组合直接memcpy，其余进入converter且read=0；source representation其它值（包括2）进入converter且read=1。只有后一路按source宣称字节数与serialized字节数的unsigned比较，把较小的signed返回状态升至3或4；原错误20/39等不会被覆盖。
- action1：只设置destination.bytes，目标representation2用serialized字节数，其余用native字节数；直接返回，完全不advance，不调用converter或resolver。
- action2：解析destination，先复制到scratch，再把source.data复制到解析出的目标，最后把scratch复制回source.data。这里source始终作为直接地址、destination按resolver描述解析，不由representation重新选择协议。
- 其它action：原样返回0，不操作数据或advance。
- action0/2完成后，只要advance非零，就按各端点representation推进data字段：representation0不推进；representation2推进serialized长度；其它非零representation推进native长度。错误状态也会推进；保留32位地址加法，不添加新的成功条件。

## ECX回退不是固定0

action0中，resolver的回退值来自真实指令：source0→destination1和source1→destination0为native字节数；source0→非1转换路径为0；source非0/1→destination0为source representation。

action2的两次回退分别依赖helper入口ECX、首次CRT memcpy之后的volatile ECX。源级cdecl无法自动表达这两个原寄存器，因此末参`TypedTransferVolatile32`显式记录。正常selector0/1/2/5/7完全不消耗该状态，六参调用可以使用默认值；**默认0只是源API默认，不证明action2其它selector下原ECX为0，也不保证这些路径等价**。使用其它selector时须提供实际状态。原机器码测试给入口和首次memcpy出口设置相同的明确位值，再把这些值传给恢复函数。

这不是对原函数添加selector有效性guard，resolver仍保留全部原switch分支。它是把已观察到、但在高层调用原型中隐含的寄存器依赖显式化。

## 原码差分方案与范围

只提取394字节helper与68字节resolver+表，分别绑定SHA：

- helper：`89f5a4dcf312d72795e80db2e69dda872e8ad833d94701aa0013fbfc5b94573c`
- resolver span：`6265cab76eb2ea10426d05b08ef28f9c3541da0feeb62ec3d191be3643322478`

运行前BCrypt核对hash。resolver的1个switch基址与8个jump目标全部重定位到复制件；helper中6个resolver CALL指向该真实复制件；5个memcpy CALL接到明确的host标准内存操作边界。converter通过测试cdecl地址传入。没有启动PE入口、加载目标导入表或运行其它目标代码。

差分比较全部context字节、三个512字节数据区、返回状态、converter四参/端点快照/调用顺序。原memcpy地址事件另核对由独立已差分resolver构成的调用计划；源标准memcpy不安装跟踪hook，因此不声称直接捕获了恢复函数内部每个memcpy调用。固定不同数据模式与偏移同时检查复制的可见结果。

已通过1,520个resolver组合（selector0–15及三个32位极值，base/offset/fallback含wrap边界），234,774个transfer场景。transfer包括全部action0/1/2/unknown、representation0/1/2、advance、正常5种memory selector、长度0/4/16/28、serialized长度与source长度的边界、signed状态极值及3/4/20/39；另包括action2回退selector在显式ECX状态下的1,440个场景，以及source其它representation和action0回退converter路径。

实际MSVC x86构建及原码差分已通过。根代理的staging CTest日志中已核对本模块输出；独立模块构建亦使用`/O2 /MT /EHsc /W4 /WX`完成相同数量验证，稳定日志保存在`tests/typed_transfer-build/typed_transfer-build.log`与`typed_transfer-test.log`。结果为`PASS: 1520 typed resolver cases; 234774 typed transfer cases; 192240 original memcpy address events and 45414 matched converter events`。验证后未修改header、实现或测试源码。逐文件hash、测试二进制与日志hash见`provenance-typed-transfer.json`；总构建的最终日志归档由根代理统一处理。

测试参数依次为`tests/typed_transfer-original.bin`与`tests/typed_transfer-resolver-original.bin`，需要MSVC x86和bcrypt.lib。模块未修改CMake、根构建脚本或恢复状态。

复现提取（在`recovered/native`目录）：

```powershell
python tests/typed_transfer_extract_fixture.py ../../analysis/unpacked/GSP5chs.exe tests
```

未验证完整PE、所有调用者、非法指针/越界长度、重叠memcpy、真实CRT volatile寄存器输出或任意converter的正确性。对象头真实converter及封装的组合验证由根代理负责；本局部结果不能扩大为完整GSP读写或几何内核完成。
