# 原生 genera 匹配器恢复

本模块恢复真实原函数`0x00442C40`及其依赖的90行原生genera表。代码依据原指令转写，表从已锁定SHA的PE逐字节恢复；没有采用Java的genera编号，也没有构建替代的几何类型系统。它只恢复一个原生类型/父模板匹配入口，不代表完整约束求值或几何内核已经恢复。

## 来源与接口

原件为`analysis/unpacked/GSP5chs.exe`，x86 PE，首选ImageBase`0x00400000`，SHA-256：

`de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`

REA完整Listing来自`analysis/recovery-pass2/type-compatible.json`，Evidence ID：

`ev_6634e171715ad0a585bf5c63fe73e1446178970630bf6db65ea870d749a6988e`

辅助表证据为`analysis/recovery-object-dispatch.json/.md`。本模块未开启REA会话。`tests/genera-original.disasm.txt`由本机LLVM objdump对同一SHA原件的确切120字节范围独立反汇编，不赋予伪造的REA Evidence ID。

源接口为`gsp::FUN_00442C40(int32_t actual,int32_t expected)`，返回完整32位0/1。原指令从`stack+4/+8`读取两个有符号整数，使用`RET`，递归调用后由caller清理8字节；源API按cdecl表达该可见约定，原始C/C++声明和原厂符号未知。调用者应提供内部genera索引，不能直接传文件external ID。

## 完整表与原控制流

`gsp::DAT_0064F290`保留`90 × 24 = 2160`字节，原范围`[0x0064F290,0x0064FB00)`。`GeneraRow32`保留全部六列，`+4/+8`用无业务臆断的`field_04/field_08`命名，尚未完全识别的`+0x0C/+0x10/+0x14`也保留原值。完整表SHA-256：

`a405c3bd79026f2a1928c15b5c646d1c92e9ac4fc6d34b4b6a06d9becce314a2`

匹配器依原有signed比较工作：

1. `expected >= 77`时先递归匹配该行`+4`，成功即返回1；否则递归匹配`+8`，成功返回1，否则0。77–89为联合模板，包含嵌套模板。
2. `expected < 77`时，`actual >= 77`立即返回0。否则在`actual > expected`期间沿`actual`行`+4`前进，最后返回两者相等与否。

联合模板只在右侧expected展开；例如`actual=77,expected=77`的结果也是0。实体行的`+8`不会在普通继承遍历中取代`+4`。代码没有把关系扩成对称相交、集合包含或新的类继承规则。

所有有效实体行0–76的父链和联合行77–89的引用均来自原表。文件external ID是每行首列，和内部索引并不处处相同，Java0–9枚举也不参与本模块。

## 有界原机器码差分

测试只加载`[0x00442C40,0x00442CB8)`的120字节原函数和上述2160字节原表。函数fixture SHA-256：

`10dd2dc6367b946623b8c189049e656084536bd7b28f6f6924a21f4ece23a065`

加载前以BCrypt SHA-256核对两个fixture。测试不固定映射原地址，而在分配的测试副本中重定位下列明确操作数：

| 原指令 | 被重定位的立即数位置 | 原值 / 新值 |
|---|---|---|
| `0x00442C51` | `0x00442C54` | `0x0064F294` → 测试表基址+4 |
| `0x00442C6D` | `0x00442C6F` | `0x0064F298` → 测试表基址+8 |
| `0x00442CA3` | `0x00442CA6` | `0x0064F294` → 测试表基址+4 |

两条递归CALL在`0x00442C61/0x00442C75`，测试核对原目标确为`0x00442C40`后显式改为测试函数入口。因为整个函数整体移动，递归rel32位模式恰好保持相同；没有让递归掉回原PE或恢复C++函数。表保护为只读，函数保护为只读可执行。没有启动PE入口、初始化导入表、调用目标分配器或执行其他目标函数。

测试先检查已编译`DAT_0064F290`全部2160字节等于原表，再比较所有有效索引组合：`actual∈[0,89] × expected∈[0,89]`共8,100组。其中实体/实体5,929组，expected联合模板1,170组，以及联合actual/实体expected拒绝分支1,001组。全部13个联合模板、嵌套递归、第一分支成功、第二分支成功和双分支失败均在完整笛卡尔积中覆盖。另运行21组经指令确认不会越表且会终止的边界输入；这不把全部非法整数域宣称为已验证。

统一CTest的`original_genera_differential`验证8,121组场景，包括8,100组有效索引与21组安全边界。表字节一致，577个结果为1（含边界测试）；实际源码、fixture和测试产物身份见`provenance-genera.json`。

测试需要MSVC x86、C++17或更新、Windows BCrypt（源码使用`#pragma comment`链接bcrypt.lib），参数依次为`tests/genera-original.bin`和`tests/genera-table-original.bin`。统一构建已登记本测试，日志身份见`provenance-genera.json`。

fixture可复现提取（在`recovered/native`目录）：

```powershell
python tests/genera_extract_fixture.py ../../analysis/unpacked/GSP5chs.exe tests
```

## 未扩大验证的边界

原函数没有参数范围、父链循环或递归深度保护，恢复代码保留这一点。`expected>=90`会越过90行表，某些负数expected会使实体父链在0自循环而不终止；其他负索引组合可能越表。未执行这些非法或非终止场景，也没有通过加guard来改变原控制流。

局部差分只比较源返回整数和原表一致性，不声称偶然寄存器值/EFLAGS相同，也未验证原调用者、完整父模板解释器`0x0043B170`、约束回调或全软件几何行为。原始源码文本、调试类型名和精确原编译配置仍未知。
