# 原父引用serializer恢复

本单元恢复原 `FUN_004A7220`，将父对象指针、页内临时保存ID和加载ID映射连接到真实typed context。源函数在 `src/parent_references.cpp`，接口在 `include/gsp/parent_references.hpp`；不是新的通用vector解析器，没有删掉representation0或用成功stub代替未恢复逻辑。

完整证据：`analysis/recovery-pass2/parent-reference-serializer.json`，Evidence ID `ev_864832f5a91a2f019ec2dbe8386cf0ad2e4b58ffb73b51c6e8541be7e237bd2d`。已逐指令核对全部Listing：原函数体371字节，两段为 `0x004A7220..0x004A734C`、`0x004A7350..0x004A7395`；含3字节间隙的地址span共374字节。完整Listing保存在 `tests/parent_references_original_listing.txt`。

## 原结构和稳定API

复用 `object_header.hpp` 的64字节 `TypedContext32`，其中source endpoint在+8、destination endpoint在+0x24。每端点28字节，字段保留原偏移/union别名，不强行赋予全局通用类型。

```cpp
std::int32_t gsp::FUN_004A7220(
    TypedContext32& context,
    const ParentReferencesEnvironment& environment);
```

原入口是cdecl callback(context*)；恢复API显式注入原来读取的三个全局量：

| 原全局 | 环境字段 | 本函数中的真实用途 |
|---|---|---|
| `0x006BBA54` | `short_handle_base_006bba54` | 当前页短handle arena基址；不是父数组本身 |
| `0x006BB510` | `id_to_object_006bb510` | 加载ID→对象指针bits的u32数组，按index×4访问 |
| `0x006BB514` | `id_upper_bound_006bb514` | 独占上界；合法ID满足1<=ID<bound |

环境没有默认值/恒成功回调。基址、数组和对象的所有权、分配、生命周期由原调用者负责；本函数完整Listing中没有分配器调用，因此不引入伪造allocator。

### Representation

| 值 | source | destination |
|---|---|---|
| 0 | context+0x14，即source.meta_0c/handle_0c；0表示空，非0时arena+handle+2读u16数量、+4为父指针槽 | context+0x30，即destination.meta_0c/handle_0c；同结构，但现有u16数量作为本次可容纳项数，未分配新存储 |
| 1 | source.data_08指向`[u32 count, u32 entries...]` | destination.data_08先写u32 count，再复制entries |
| 2 | 相同count32布局，但额外检查声明的源记录长度 | 相同count32布局 |
| 其它 | 原默认分支把context地址同时当作源地址和count数值 | 原默认分支把context地址当目的缓冲，不先写count |

representation0不把data_08当数组指针；该word在公共类型里也有selector别名。短handle结构前两个字节未被本函数解释，+2是u16项数，+4开始是4字节条目。header中的 `ParentSavedNumberPrefix32` 仅命名了对象+0xC4的临时保存编号，其余字节保持未知。

其它representation的原默认路径很危险，不能据此宣称任意值都有效；源码保留其原分支，差分只进入不会触发原非法大拷贝的安全子路径，没有加新的“unsupported→成功”判断。

## Action与真实转换顺序

所有action先读取源数量并计算uint32 `bytes=count*4`。

- action0执行复制/转换。目的representation0先读取已有项数，若少于source count立即返回，不copy、不分配、不更新数量。目的representation1/2先写count32，再复制原条目。
- memcpy完成后，若**当前context中的**source representation为0，逐项把对象指针改成该对象+0xC4的临时保存ID。不是先造一份新vector再提交。
- 随后若**当前context中的**destination representation为0，逐项检查ID范围、查加载映射，并原位写回对象指针bits。
- 因此0→0也经过“指针→临时ID→加载map→指针”，不能简化成直接复制父指针。
- action1只写destination.bytes_04：原生representation0是count×4，其余值加4字节count前缀；保留uint32溢出。source/destination指针不推进。
- 其它action读取完源数量后返回0。这个函数自身不消费advance_04；不能把另一个typed helper的推进逻辑移植进来。

目的默认分支可能覆盖context本身；原码在memcpy后重新读取两侧representation。源码保持重读，未使用先前缓存值决定后续指针/ID转换。

## 返回、warning及部分写入

| 条件 | 原返回与副作用 |
|---|---|
| source repr2且`bytes+4!=0`，声明长度>`bytes+4` | 先记录pending warning4，尚不返回 |
| 目的repr0现有项数<count | 只在此处返回pending warning，可能为0或4；目的字节和u16数量均不变 |
| 成功复制、量测、其它action | 返回0，**丢弃pending warning**，不能改成统一返回4 |
| 指针→ID时对象+C4为0 | 返回13；此前项已改成ID，当前项和后续项仍保留copy得到的指针bits |
| ID为0或ID>=bound | 返回39；此前项已映射，当前和后续项保留copy得到的ID |
| 合法ID映射值为0 | **先把当前槽写0**，再返回12；此前项已经映射 |

例如指针输入 `[P0,P1,P2]`、保存编号 `[7,0,9]` 写到count32缓冲时，失败13后的内容为 `[count=3,7,P1,P2]`。ID输入 `[1,2,3]` 且map[2]=0时，目的原生槽变成 `[map[1],0,3]`，返回12。未做回滚或事务化拷贝。

目的repr0只把原u16数量用于容量比较，不把它收缩到source count；不足分支也不改它。过长记录warning通常被共同返回0覆盖，这是原控制流，不能为“修复错误”而改变。

## 实际编译与原码差分

独立复现命令（工作区根目录）：

```powershell
& '.\recovered\native\tests\parent_references_build_probe.ps1'
```

探针使用已安装MSVC x86、`/O2 /W4 /WX /fp:strict`，复用根工程已有ASCII junction，输出到独立parent-references-probe目录。没有编辑公共构建脚本。

实际通过 **42,106场景，0差异**：23,487场景经过representation0，9,189场景量测，18,692场景涉及安全默认分支/非复制action。原返回0/4/12/13/39分别出现39,223/350/519/636/1,378次。

比较EAX和完整context、短handle arena、源/目的vector、所有对象及加载map字节，包含数量、未触碰槽和canary。测试覆盖：

- 0/1/2两侧representation及action0/1/2/0xFFFFFFFF组合；空handle、非零handle、非对齐handle、不同目的容量。
- source物理条目为真32位对象指针，读取实际对象+C4；加载map含真实对象指针、非恒等重映射与空项。
- 各失败位置的部分写入、无效ID、独占bound边界、丢弃warning和容量不足返回0/4。
- count×4、+4的uint32回绕；大count在只量测或容量不足路径执行，未发起非法巨大copy。
- 12,000组固定种子的随机输入；advance及未解释meta字节被完整比较。

原码只在测试中使用。代码span SHA-256为 `a772e8ea62b08990503f7a5ef121044be472876f5a4272f022efd947578f3fbc`；运行前BCrypt核验374字节。四处明确绝对global操作数逐一核对原值后重定位，唯一 `0x004A7300→0x005FB600` 原memcpy调用重定向到声明的host memcpy；原分支、循环、失败码和指针/ID算法未替换。赋予只读执行权限后仅调用这个入口，不执行PE入口、导入表、原allocator或应用生命周期。

## 环境依赖与集成边界

短handle arena分配/迁移已由[父引用arena](RECOVERY-parent-arena.md)提供，加载map辅助生命周期见[加载映射](RECOVERY-load-map-lifecycle.md)，保存编号由页面保存外层设置。本单元仍要求调用方提供有效环境；真实对象读取、map填充和完整页面生命周期尚未闭环。原memcpy与host memcpy的差分域限合法缓冲及非重叠复制。

本函数连接对象记录2002的父引用转换。typed writer、共享scratch/分配策略、记录IO及`0x0040E130/0x0040E440`均由独立模块提供，组合测试见[对象保存集成](RECOVERY-serialization-integration.md)。这些局部验证不证明整个GSP保存/加载完成。

逐函数来源、原ABI、fixture原值重定位、源码哈希和实际结果见 `provenance-parent-references.json`、`tests/parent_references_original.json`、`tests/parent_references_validation.json`。
