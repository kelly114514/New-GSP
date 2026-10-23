# 记录类型窥读与流位置查询

2026-10-19。恢复 `004B9FF0..004BA0C5` 的214字节及 `004BABA0..004BACBA` 的283字节。原目标SHA-256为 `de41b856eb11657a27e64ea14ecdab4e1aef6518e02e7cc39d2713b260964e7a`。

证据为 `analysis/recovery-pass6/stream-peek-kind.json`（`ev_e365c6b40fe5fb158ee0735be748d4be5e78e808e3026233366e74a8b8fcc905`）及 `stream-tell-position.json`（`ev_d254f874373261295ecd36e1127a94932b35d6ffdafefa097cdfb55ddad4b963`），同时保存固定PE完整Listing与字节fixture。

`FUN_004B9FF0` 检查sticky error，保存原位置，通过真实字节读取两次取得长度和kind，再尝试绝对seek恢复；它不把read或seek状态作为返回值。恢复位置失败可留下sticky error和变化后的位置，已成功读出的kind也可能仍被返回。最后一次registry lookup虽丢弃结果仍必须发生。

`FUN_004BABA0` 每个原lookup点重读真实registry槽。已有sticky error时不写输出；type1清errno后调用显式原ftell边界，先写出ftell返回位，再判断-1及errno。其余类型返回缓存位置。tell错误本身不写为sticky error。`StreamTellCallbacks32` 保留原CRT `005F663F` 依赖；未恢复FILE内部实现。

实际MSVC Win32/x86严格构建通过。差分：49,200组peek、189,027组position；另比较81,984次stdio事件，事件和sticky计数不混计为差分案例数。原码簇共2358字节加75字节分发表，执行真实read/seek/error/内存/table链；497字节是本单元新增原函数。比较全部registry/stream/file/chunk/errno/output状态及调用轨迹。覆盖sticky、读半包、EOF、恢复失败、short句柄、高位位置、ftell与errno组合、输出alias及回调切换registry/errno。

测试仅运行已审阅原函数簇；生产库不包含机器码，未执行PE入口。分配器不应进入本测试域，越界索引/非法指针/未初始化type4头及真实CRT FILE布局不据此认定等价。统一构建记录见`recovered/artifacts/native-msvc-x86/native-build.json`；`provenance-stream-inspection.json`绑定`original_stream_inspection_differential`的不可变CTest日志及输入身份。
