# 对象保存的实际恢复函数接线

`serialization_integration.cpp`是源接口装配，不对应新增原函数地址，不增加原函数计数。

`ObjectSerializationIntegration32`及`bind_object_serialization_environment32`将已恢复`004A7A60`绑定到真实writer、对象头、点serializer、父引用arena适配、动态外层、tell、seek、record→byte→memory→分页表。原`ObjectSerializationTypedChain32`同时增加可选点数值环境，保持已有aggregate调用兼容。

父引用每次转换重新读取arena/map槽，避免量测与实际转换之间临时分配移动arena后使用旧基址。接口借用环境和槽，调用者负责其生命周期。constraint-extra环境存在时，004A73A0走真实恢复实现；其余类型converter、钩子、legacy记录依然是必须显式提供的依赖，无默认成功。

## 原码组合对照

`tests/serialization_integration_oracle.hpp`由既有稀疏oracle扩展；所有片段按既有fixture哈希锁定，统一VA delta保留内部CALL，未加载PE入口或imports，生产库不含oracle。装入对象943B、动态558B、writer、点/对象头/父引用、记录、byte、memory、表和tell；第二组另装入真实约束extra闭包和原表回调。

测试通过3648组点/父引用、6066组动态外层边界案例、864组真实2003约束记录组合；其中4740组实际发生临时分配期间arena移动。移动时拷贝arena并毒化旧区，比较对象、scratch、临时缓冲、两个arena、输出流完整字节、所有stream字段、表、mode、返回状态和事件序列。

动态组的实际类型converter与保存钩子仍是有副作用/失败/警告的测试边界，不能记为12个动态类型或5个真实钩子已恢复。真实约束组使用00422DD0，对象状态仅用于验证已选保存路径，不代表完整几何对象构造/约束合法性。

覆盖旧/新对象头布局、短父向量与大向量、共享/动态buffer、分配失败、sticky error、短输出、status13回退、钩子失败清理及全局槽变化。FILE、原CRT分配/数值/palette仍按声明边界，非法输入和完整文档/页生命周期不属于本测试。

独立入口为`tests/serialization_integration_build_probe.ps1`；统一构建由CMake/manifest登记实际输出。未闭合的边界为页面拥有权、工作表预处理、页面serializer和实际对象读取/修复；实施顺序只见[总计划](../PLAN.md)。
