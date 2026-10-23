# 对象保存分发 004A7A60

恢复完整外层流程及与既有 typed writer、对象头、父引用恢复的适配接口。原生产表完整保留 20 行 × 0x84 字节；其中函数地址仅作为回调身份，不执行原 PE 代码。

原件身份为 `analysis/unpacked/GSP5chs.exe`，SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。REA Evidence `ev_5872e10688a318df8585995def94ddbd8e814e41cec959ff37183ad3b91d763d` 保存于 `analysis/recovery-pass2/object-serializer.json/.c`；表关系另见 `analysis/recovery-object-dispatch.*`。独立 LLVM Listing 从相同原字节提取完整 `[004A7A60,004A7E0F)`，943 字节。函数在 RET 004A7CBD 后仍有可达分支，不能在那里截断。

原 ABI 是 EAX=object，cdecl 栈参数 `(handle, metadata_four_words, u16 argument)`。对象只按原偏移访问 `00/0C/40/AC/B4/D0`；`+40` 的有符号比较保留，不能误写为 `+10 genera`。主表 +30 钩子为 cdecl `(object, handle, metadata, numeric_phase, state_slot*)`，phase 0/1/2 的原压栈值已核实。

- entry 的 +30 钩子在 tell 前取快照；工作 kind 和 constraint 在 phase 0 后重新读取。后续回调改变 object.kind 不会改变已经选定的工作行，constraint snapshot 也不会被后续改写替换。
- 状态采用 signed max，初始 0。tell/phase0 的 13 不立即停止；普通记录的 13 则清理并回退。9006 的 13 仍执行 phase1 和2007；phase1 的 >=20 直接结束，不再调用 phase2。phase2 的返回值被忽略。
- 仅最终状态等于13时调用 seek，offset 为 tell 保存值，origin=0；seek 返回值按 signed max 合并。此函数没有分配/释放 hook state 的补造行为，所有真实状态处理由原回调接口承担。
- source context 仅初始化原代码写过的 advance、representation、selector 和 base；其它自动存储字节入口没有定义值。writer 会初始化它自己的字段。测试首个边界只比较已定义字段，之后由测试边界写全64字节，再逐字比较后续保留情况。

`object_serialization_typed_record32` 将 0043D190 接回真实 `FUN_004A7430 -> FUN_0043D190 -> FUN_0040E440 -> FUN_0043CD70`，将004A7220接回真实父引用恢复；writer 的 IO user、allocator user、其它 converter user 分开传递，避免局部桥接状态覆盖原依赖。其它converter地址必须由调用者提供真实实现。

完整接线见 [对象保存集成](RECOVERY-serialization-integration.md)：`004BABA0` tell、`004A7830`动态外层、`004BA9B0` seek、`004B9DF0` record IO均已有恢复实现；提供constraint-extra环境时，`004A73A0`接入真实约束extra模块，其中`00422DD0`为已恢复的1种payload。上面的窄适配器与完整集成接口覆盖范围不同。仍缺`004380A0`旧格式记录、主表+30的5种钩子、12种动态converter，以及主表+2C其余类型（包括`00460440`）和其余17种约束extra serializer。没有默认成功实现或生产oracle。

复现：`native/tests/object_serialization_build_probe.ps1`。它先执行fixture提取和PE/表哈希核对，再以现有MSVC x86 /O2 /W4 /WX构建隔离probe。测试执行原943字节函数副本，6处表操作数、12处relative call经身份核对后重定位到显式测试边界；加载前使用BCrypt验证代码和表SHA。没有PE loader、原入口或原回调执行。

验证结果：803,735个外层原码差分场景，0不一致；39,233次rollback、35,754次phase2、165,311次phase1、2,299,626个typed调用、196,809次legacy调用。覆盖全部20原表行、可选记录组合、有符号极值、版本边界、每个边界的警告/失败、状态叠加及回调内对象/metadata改写。175个合成行场景专门覆盖真实数据未触发的外部ID>=20和slot60负数分支，合成行不宣称来自发行件。

另有68个适配器联调场景：真实对象头版本1/2/4/5/9及native/serialized representation、真实父向量0/1/255/256/1025个元素、shared/allocated缓冲路径、未恢复converter两遍调用、状态与IO转发。真实父serializer在两种目标representation中都将native对象指针转换成临时保存编号，测试按此核对实际payload。联调范围不扩张外层差分的原码覆盖声明。

本项证明外层分发及适配接口，不证明全部对象payload、页面完整保存或桌面程序已恢复。机器记录、fixture来源与生产文件哈希见 `provenance-object-serialization.json`。
