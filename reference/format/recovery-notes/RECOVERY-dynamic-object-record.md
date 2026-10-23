# 动态对象记录转换外层

恢复 `004A7830..004A7A5D` 完整558字节；目标SHA-256 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。Evidence来自`analysis/recovery-pass6`： `ev_25414d90c32c616b1470e4726f9df601189db576230db67a1b6ee9c934d0e33e`，完整LLVM补齐free误标导致的反编译缺失分支。

原函数从主kind表 `+44` 捕获converter。第一阶段先action1量测、按量测长度分配，再action0转换。全局mode非零时直接记录第一buffer；mode为0则将完整destination端点复制为source，重读metadata构造representation2端点，进行第二轮量测/分配/转换。

量测长度是快照，后续callback修改context长度不会改变该轮record长度。状态13在第一轮不统一截断；第二轮量测/转换后仅在状态小于20且不为13时继续。负callback结果不会降低从0开始的状态。两个allocation失败均返回100，并保留应有清理。

第二轮成功先free第一buffer并清本地指针，再重新读全局mode选择记录payload。free回调若改变mode，原函数可能选择已清零的第一指针；源码保留该顺序，测试记录这一边界选择，不以成功IO stub推导该输入下完整原程序可成功。其余出口按原顺序清理first/second buffer，record错误参与signed最大值累积。

源码通过 `DynamicObjectRecordEnvironment32` 接原kind表、mode槽、分配器、converter与record IO；没有默认成功实现。实际kind `+44` 回调及完整应用装配仍待恢复，不能将本外层恢复描述为全部动态payload类型已完成。

实际MSVC Win32/x86、`/O2 /W4 /WX /fp:strict`独立构建通过，194,400组原码差分0差异。oracle执行完整558字节，核对20行2640字节原表；按原callback身份生成仅用于测试的callee桥，比较已定义context字段、对象/metadata变化、完整buffer、mode、返回及分配/转换/写出/释放轨迹。覆盖全部有原callback的kind、两轮0/小/大长度、各阶段负数/警告/13/20阈值、分配失败、回调和free改mode、metadata和object kind改变。

第一次callback前原栈有未初始化字段，测试只比较原函数已写字段，并由显式converter契约初始化其余值后比较后续完整相关状态；不伪造初始全零。非法表下标、空callback、原converter算法、实际CRT分配/FILE和并发不在此证明范围。生产不含原机器码。
