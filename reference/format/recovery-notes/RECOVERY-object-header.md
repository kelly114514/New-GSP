# 原对象头转换恢复

本单元从固定哈希原生PE及完整Listing恢复3个原函数，已在本机MSVC x86实际编译并通过原机器码差分。没有写新的通用GSP解析器，也没有把原函数作为生产运行包装。

| 原函数 | 原ABI和返回 | 恢复源码 |
|---|---|---|
| `0x0043CCD0` | AX=packed u16，EDI=三个u32输出；EAX=0/1 | `gsp::FUN_0043CCD0`，源API正规化为cdecl |
| `0x0043CD50` | EAX=style数组指针；EAX=0/1/2 | `gsp::FUN_0043CD50`，返回u32，**不是反编译器误标的bool** |
| `0x0043CD70` | cdecl(dst,src,readFlag,serializedEndpoint) | `gsp::FUN_0043CD70`；另显式传入未恢复的palette环境 |

代码在 `include/gsp/object_header.hpp`、`src/object_header.cpp`。同文件的主kind、genera、constraint原表及逆映射常量保留原行宽与全部原列；`tests/object_header_extract_fixture.py` 从固定哈希PE机械核对这些常量，不凭Java编号重建。

## 上下文、对象及文件布局

`TypedContext32` 已核实为64字节：action在+0、advance在+4，source端点从+8，destination端点从+0x24。每端点28字节：representation/+0、bytes/+4、data/+8、四个原meta字段/+0x0C/+0x10/+0x14/+0x18。对象头转换只使用长度、meta_14和version_18，未给其它字段虚构业务名。

`0x0040E440` 的完整Listing支持以下观察：action0执行拷贝/回调转换；action1只计算目的长度；action2做三次memcpy交换；advance非零时按各端点representation及两种长度推进指针。它现已在独立 `typed_transfer` 单元恢复并验证，action2不能叫作“比较”。resolver还确认representation0的+8为selector、+0x0C为base/handle，公共声明已增加保留原布局的union别名。

`ObjectHeaderPrefix32` 精确保留对象前48字节：constraint/+0、原field04/+4、原field08/+8、kind/+0x0C、genera/+0x10、原u32/+0x14、float/+0x18、三个style原u32/+0x1C、原u32/+0x28、原u32/+0x2C。它不是完整GObj声明，不含vptr假设。

| payload偏移 | 已证实映射 |
|---|---|
| +0x00 u16 | constraint外部ID，经原128项表转换；反向经constraint行首列 |
| +0x02 u16 | 对象field08；读值>4会降到1并返回warning4；旧版写出有另一套降级规则 |
| +0x04 u16 | 对象field04低16位 |
| +0x06 u16 | 主kind外部ID，原20项映射 |
| +0x08 u16 | genera外部ID，原100项映射；不可识别时可能从constraint行+8回退 |
| +0x0A u16 | version<5使用旧style枚举0/1/2，否则按4bit字段拆解，夹无效值并报告warning |
| +0x0C..0E | 对象field2c低24位；写出+0x0F固定0 |
| +0x10 u16 | 乘/除65535.0的float比例；0明确保留为0 |
| +0x12..13 | 原转换器不写，保留原缓冲内容；没有为“规范化”补零 |
| +0x14 u32 | 对象field14 |
| +0x18 u32 | 对象field28 |

外围 `0x0043D190` 封装在目标representation为2时按目标version选择12/16/28字节：version1→12；其余<5→16；>=5→28。本单元核实了这一真实封装，不把它改成新的格式探测；封装与helper现已在独立模块恢复，并与writer及父引用做原码组合差分；本单元仍只计原kernel3函数。

核心函数的实际条件比三种标准头长更细：总长<12返回39；读长>28返回warning4；长度>16便读取+0x10及+0x14，长度>24再读+0x18。因此伪长度17、25等仍会发生更宽的原内存访问。测试给足物理缓冲并保留这些行为；生产API未增设一套改变原返回/部分写入行为的安全parser。

## 数值和状态细节

- style decoder恢复原来的4bit拆解和夹取，输出写入顺序为第三、第一、第二项；高4bit非零也报告修改。
- 旧style reducer的真实EAX可为2，若照C反编译输出定义为bool会丢失此状态。本实现按完整Listing的EAX恢复。
- 读侧先做x87除法，再明确存成float，随后才校验0..1范围；原字段的0是有效比例。
- 写侧Listing先乘65535.0，临时把x87控制字舍入模式设为toward-zero，FISTP到signed32，恢复控制字，取低16位。反编译里的`ROUND`不能替代它；源码保留必要x87操作，NaN/Infinity/越界不靠未定义的C++强转模拟。
- 返回0、4、5、12、13、39分别保留原路径；未将warning一律升级成失败，也未用成功stub遮住未恢复依赖。

## 明确的外部边界

读侧 `endpoint.meta_14==1` 必须调用原主kind行+0x74的selector(0)，再从当前页面+0xAC数组按返回下标取得field2c。原函数不能由记录中低24位替代这条路径。

本源码通过 `ObjectHeaderEnvironment.kind_slot_74` 与 `current_page_values_at_ac` 暴露这个未恢复边界。调用者必须提供实际行为；无默认值、无返回成功替身。差分时原/恢复双方使用相同测试selector和page数组，比较调用kind/参数事件；这证明头转换与边界调用协议，不证明20种原selector或真实页面palette逻辑已恢复。

## 实际验证

独立探针命令（工作区根目录）：

```powershell
& '.\recovered\native\tests\object_header_build_probe.ps1'
```

它复用本机已存在的MSVC/Windows SDK和根工程建立的ASCII junction，独立输出到本地 `GspRecovery/sketchpad5/object-header-probe`，不修改CMake/root脚本。编译选项包含x86、`/O2 /W4 /WX /fp:strict`。

已通过 **298,629个头场景**（286,764读、11,865写）及 **65,561个样式场景**，0差异，结果在 `tests/object_header_validation.json`。

覆盖全部65536个输入constraint/genera/kind外部u16，各自独立变化；全部65536个比例编码；全部65536个packed style输入；长度0–40、version0/1/4/5/6、meta0/1/2/3组合；全部有效内部索引分别写出；旧版本拒绝/降级；负数field08；零、符号零、最小非零float、相邻1、NaN/Infinity和越界float。每例比较EAX、全部64字节输出和canary、palette边界事件。

测试原码限定为1216字节簇 `0x0043CCD0..0x0043D18F`，只进入上述3函数；通过BCrypt SHA-256核对代码、原表数据和65535.0常量后才赋予执行权限。16个明确且逐一核对原值的绝对数据操作数被重定位到测试副本；内部相对helper调用保持原字节。kind+0x74表项改指向明确测试边界，其余不重写原算法。没有加载PE、导入表、UI、线程、网络或应用生命周期。

差分证明限于实测输入和声明边界，不含完整x87状态字/异常标志相等、未屏蔽FPU异常、故意越界原指针及别名重叠。入口有效缓冲等原前提由调用者负责。

## 父引用与typed record依赖

`0x004A7220` 不是普通count+vector解析器。`analysis/recovery-pass2`中的完整Listing显示它依赖：全局页向量基址0x006BBA54；source representation为0时从短句柄取u16数量和真实父指针；序列化写侧把父对象+0xC4临时编号写出；读侧用0x006BB510数组、0x006BB514边界还原指针；action/两侧representation共同决定计数、量测和返回值。非法编号、空映射、目的容量不足都有不同返回和部分写入行为。

`0x004A7430`负责action1量测、action0执行、共享1024字节缓冲/分配器、记录层调用和全局模式。本单元只计对象头kernel的3个函数；父引用、typed helper、writer、分配策略、record/byte/memory stream及arena/map辅助函数已在各自模块恢复。真实对象构造、加载map填充、页面拥有权和完整文档读写仍未闭环。现有组合验证见[对象保存集成](RECOVERY-serialization-integration.md)。

逐函数字节哈希、完整Listing Evidence ID、源码与测试哈希、测试边界和未完成项见 `provenance-object-header.json`。
