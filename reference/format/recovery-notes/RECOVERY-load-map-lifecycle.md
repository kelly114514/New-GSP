# 页加载映射生命周期恢复

原函数 `004AA310..004AA559` 共586字节，目标SHA-256为 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。本单元恢复外层编排，未宣称内部对象解析、arena或完整加载链完成。

## 证据

`analysis/recovery-pass6/load-map-lifecycle.json`，Evidence `ev_2ddb791be417ab7f6e95b0380ddb683b1ec528b84b2438a45423159b0220afa0`。Ghidra仍因 `_free` no-return误标，body只有571字节、span586字节，遗漏 `4AA541..4AA54F`。`tests/load_map_lifecycle_extract_fixture.py` 从固定PE按节表提取全部586字节，以llvm-objdump逐指令核对，包含实际结尾RET。原REA body与独立完整listing分别保留，不能混称为REA完整CFG。

## 行为

- 函数进入立即快照 `*count`；prepare与records即使改变传入count，分配大小和对象循环仍用快照。`saved_count+1` 和乘4按32位回绕，循环使用signed比较。
- 返回状态为从0起的signed最大值；各阶段达到20进入清理，负数不会降低已有状态。首次peek返回值故意忽略。
- 分配前提交 `6BB514=快照+1`，tag4分配映射。失败返回100，不改旧map，不清upper；成功才提交map，随后所有出口释放本地分配并清map与upper，即使回调替换了全局map。
- records依次phase0、对象之间phase1、最后phase2；mode0额外fixup后再次phase2。mode0要求末记录kind1003，所有非零mode要求1001，不匹配合并39。header返回非零即不调用payload；payload收到初始0的discarded局部输出。
- progress非空时，每个对象前查询位置并右移4调用progress；position返回值被忽略。外部position必须提供有效输出，未初始化输出路径不在确定性差分域。
- 清理仅在work表非空时销毁work再读取style，清work后销毁style并清style。work为空时style保持原样；销毁work的回调若替换style，使用替换后的指针。

## 真实验证及边界

MSVC Win32/x86、C++17、`/O2 /W4 /WX /MT /fp:strict`独立构建通过，`load_map_lifecycle_differential.exe <native/tests>` **11,326组、0差异**。日志：`tests/load_map_lifecycle_build_probe.log`。

oracle装载完整586字节，执行前验证硬编码SHA，改写18个外部CALL和8个全局操作数；内部控制流不变，映射后改为RX。未执行PE入口，生产不含机器码。比较有序callee事件（参数、调用时全局槽/count/对象数）、返回状态、三组完整映射内存、最终map/upper/work/style/count。

覆盖：空/单/多对象、signed负计数及长度回绕、mode0/1/全位1、所有工作表组合、分配失败、prepare/records/object/fixup/header/payload的负值、警告、20阈值、39/100及INT_MAX，多次phase调用不同返回、全部结束kind选择、progress开关、prepare/records修改count、对象修改map/upper、清理时修改style或map。巨大正计数路径限制在分配失败或首对象错误，未执行数十亿次循环。

内部prepare、peek、records、object、fixup、position/progress、header/payload、分配/free仍为显式边界；测试以有副作用/失败/警告的确定性回调比较编排，不以成功stub证明完整解析。表销毁两侧都调用已恢复且另有原码差分的 `FUN_00434050`，此测试不重复证明析构函数等价。非法指针、外部未赋值输出、并发、真实GSP对象语义尚未验证。

## 构建接入

生产 `src/load_map_lifecycle.cpp` 依赖 `src/blocktable.cpp`。测试 `tests/load_map_lifecycle_differential.cpp` 链接恢复库及bcrypt，以tests目录为唯一参数。CTest名 `original_load_map_lifecycle_differential`，测量键 `load_map_lifecycle_cases=11326`。最新集成状态由根构建独立登记。
