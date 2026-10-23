# 原对象头封装与组合保存链恢复

`src/object_header_transfer.cpp` 恢复原 `0x0043D190..0x0043D205`（118字节）封装，保持cdecl上下文参数，另传入既有旧palette环境。生产调用链实际连接恢复的 `0x0040E440`、`0x0040E130`、`0x0043CD70` 及其样式helper，没有拿另一种通用序列化实现替代。

## 封装原行为

- source representation=2时，payload长度<12立即返回39，>28先记warning4；即使action为量测/交换/未知动作，这个先行检查仍执行。
- serialized长度通常为28；destination representation=2时，version1选择12，其他version<5选择16，其余28。
- 在48字节原栈scratch上调用typed helper，native bytes=48、object offset/原EBX=0，使用真实对象头转换callback；返回原先warning与helper状态的signed最大值。
- source/destination长度、指针推进、交换、回调与部分写入由已恢复typed helper执行，不在封装中另加格式探测或事务回滚。

公共端点声明也根据原resolver修正：representation0的+8为storage selector、+0x0C为基址或短句柄；representation1/2的+8为字节指针。原父引用走selector3的专用serializer，不使用generic resolver。原字段名保留，union别名揭示不同原用途，字节布局未改变。

## 组合验证

`tests/serialization_chain_differential.cpp` 做两层真实原码组合比较：

1. **18,000个对象头封装场景**：action0/1/2/3、source/destination representation0/1/2、advance、version0/1/4/5/6、长度11/12/16/28/29、meta1/2、selector0/1/2/5/7。每种动作按实际指令准备物理有效缓冲；action2按原规则把source字段当直接指针，把destination字段当descriptor解析，并保留之后的原位推进。
2. **1,416个writer组合场景**：1,200个真实对象头回调、216个真实父引用回调；覆盖两种输出模式、全部20主kind、旧/新版本、warning与IO错误，父数0..1024、共享缓冲1024边界、分配失败与缺失临时保存ID。原writer两次调用的都是原header wrapper或原parent serializer；恢复侧调用的是对应恢复源码。原来的`io_status`输入0/4/39现在初始化真实stream的`error_24`，通过原流错误分支产生状态；不再在record调用边界直接返回这个值。

比较EAX、整个64字节context、源/目的缓冲、全部shared/allocated/handle缓冲，以及allocator/free/palette调用参数与顺序。Snapshot还比较全部8个真实`StreamState32`、整个`BlockTable32`及block指针数组、8192字节实际流输出，因此position、logical_end、max_record、error、table high_water及真实record头/payload/padding都在比较范围。这里的1,416例是模块连接证据；writer、parent、typed helper、record与byte/memory IO另有独立更广的差分，不能用组合覆盖替代各自原行为核对。

原码侧现装入18段固定哈希片段，合计6065字节（原cluster/span含padding与resolver内嵌jump表）：原有header/style簇1216、wrapper118、typed helper394、resolver68、parent span374、writer217，加上完整record三函数739、byte write/read/seek/error四函数1208、memory append/write/chunk-read/fixed-read四函数957、原blocktable簇774。另外装入byte read/error jump与index三个固定哈希表，共75字节，以及既有只读对象表/常量。

以上片段全部以同一VA地址差放入稀疏测试映像，未提交的间隙保持NOACCESS，不加载PE头/导入或程序入口。73个绝对操作数/表项按核对过的原值重定位，包括真实`DAT_006BB560`槽、byte分发表与目标指针。所有内部相对CALL/JMP保留原字节：`4A7430 → 4B9DF0 → 4B9D50/4B9590 → 4B9410 → 434150/4341D0`实际执行原始代码；原码侧没有用恢复源码替代record的底层callee。读取与seek片段也完整装入，虽本次保存组合只走实际写入路径。

恢复侧`source_io/host_io`直接调用真实`gsp::FUN_004B9DF0`，其下继续调用恢复的byte/memory/blocktable源码，已移除旧record IO成功/错误替身。两侧都使用类型3固定内存流和预分配8元素blocktable，不需要新table分配。writer临时缓冲仍使用既有显式allocator/free测试边界。

测试映像有10个显式host跳转：CRT memcpy/memset、allocator/free、reallocate以及5个CRT FILE/errno入口。其中reallocate和所有FILE/errno入口遇到即abort，不会返回虚构成功；本次固定流场景未执行它们。20个旧palette selector表项仍连接明确测试边界。原始数据/代码先由BCrypt核对SHA才赋予相应执行/只读权限。生产静态库不链接这些原码或测试跳板。

扩展后的组合测试已实际使用MSVC x86、C++17、`/O2 /W4 /WX /fp:strict`独立编译，18,000+1,416场景全部PASS、零差异；最终输出确认73个精确绝对重定位。独立日志位于`%LOCALAPPDATA%/GspRecovery/sketchpad5/serialization-chain-probe/build.log`及`test.log`，哈希与源输入见provenance的`latest_standalone_full_chain_build`。公共CMake/root/manifest未由本分工修改；下一次统一集成归档应刷新`latest_integrated_build`，此前该字段保留的是旧范围历史记录。

## 验证边界

这证明原封装、writer、record与byte/memory/blocktable保存链在所列输入及明确外部依赖下保持行为；尚不证明完整GSP文件写回。底层`0x004B9DF0`及本次走到的固定流IO现已实际连通。文件CRT分支、分配器内存压力处理、真实palette、arena/load-map与临时ID生命周期仍保留边界；type2动态追加虽装入原函数，但不是本次type3组合的执行覆盖。

typed resolver对保留selector返回ECX，action2的第二次ECX还依赖原memcpy出口。typed_transfer源接口已显式暴露这项寄存器状态；本封装组合使用实际正常selectors，未声称默认值代表未恢复的CRT寄存器结果。完整FPU标志、其它volatile寄存器、EFLAGS、非有效缓冲及完整应用生命周期不在本次等价范围。

原函数Evidence：`ev_d65246487b6528cce0dc816f9a5ec0dac2e562ee7794ef1d5b6bd70ee5056ac9`，完整来源为 `analysis/recovery-pass2/object-header-serializer.json`。当前源码与组合fixture哈希、实际集成日志见 `provenance-object-header-transfer.json` 和根 `recovery-status.json`。
