# 原版最小文档基准

这五个文件由原版 UI 创建、另存为，随后关闭文档并从磁盘全部重开。
执行程序是 `sketchpad5/GSP5chs.exe` 的逐字节副本，哈希绑定在
`baseline.json`；运行副本及 Support Files 不提交，也不进入恢复版生产路径。
完整操作及重开观察见 `ui-observations.json`。

`baseline.json` 独立声明每件样本的对象身份、外部 kind/constraint/genera、
父引用顺序、样式、颜色及自由点坐标。`verify_baseline.py` 只检查测试基准，
不是恢复内核的对象加载器。运行：

```powershell
python analysis/sessions/minimal-baseline/verify_baseline.py
```

两个自由点保存坐标为 `(211,147)`、`(411,281)`。线段保存父序列 `[2,1]`；
中点只有一个线段父引用 `[3]`，不写自由点的 kind2201 坐标 payload。
拖动后第一个自由点为 `(251,174)`，另一端不变；界面可观察到中点随动。
算术预期中点从 `(311,214)` 到 `(331,227.5)`，这部分是父坐标推导值，
没有冒充原版运行时内存采集。

默认自由点与中点的样式三个字为 `[1,2,2]`、COLORREF=`0x0000ff`；
线段为 `[2,2,1]`、COLORREF=`0x800000`。粉色选择圈来自临时选择显示。
其它未解释的页面、字体和兼容性 payload 仍是原始证据。
