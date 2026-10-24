# M2 验收：语料用例怎么生成、怎么跑、现在覆盖到哪

本目录的 `baseline-*.json` 是随仓库提交的最小用例（输入是 `samples/baseline/`，本项目用原版 UI 生成）。第三方语料的用例体积大、且由第三方 `.gsp` 派生，**不入库**，只在本机生成到 `oracle/`。协议本身见 [../README.md](../README.md)。

## 1. 复跑

```powershell
$py = "tools\oracle\.venv\Scripts\python.exe"

# 1) 从原版导出清单生成用例（不启动原版，只读 manifest + EMF + HTML）
& $py tools\emf_match.py batch --manifest oracle\full\manifest.jsonl --out oracle\m2-cases

# 2) 用实现方的适配器逐例求值并比对
& $py tools\check_m2.py --index oracle\m2-cases\index.json --report oracle\m2-report.json `
    --runner node impl\packages\core\scripts\geometry-dump.ts "{input}"

# 3) 只跑随仓库提交的 6 个基准用例（CI 里的 --self-test 只验比较器自身）
& $py tools\check_m2.py --index spec\acceptance\m2\baseline-index.json `
    --runner node impl\packages\core\scripts\geometry-dump.ts "{input}"
```

`emf_match.py batch` 的 `--max-emf-bytes`（默认 50 MB）会跳过超大 EMF：分形目录里有 70 MB 以上的单文件，它们的对象数动辄数万，跳过时记为覆盖缺口，不算失败。

## 2. 2026-10-23 结果（842 个用例，语料导出 922/1,431 时的快照）

| 项 | 数值 |
|---|---:|
| 用例（每文件一例，只取 900 头的活动页） | 842 |
| 断言 | 2,232 |
| 通过 | 2,232 |
| 失败 | 0 |
| 有断言但实现方返回 unsupported/不存在 | 0 |
| **A 组对象中没有任何断言的** | **83,061** |

断言只覆盖「祖先全部在 A 组内、且在 EMF 里能唯一匹配到图元」的对象。83,061 的构成：

| 原因 | 数量 | 含义 |
|---|---:|---|
| `ancestor_outside_A_group` | 75,502 | 父对象属于变换、度量、轨迹等尚未实现的组，A 组几何无从推算。**这不是 A 组的缺陷，是 M4/M5 的前置依赖。** |
| `hidden_html_no_emf_expectation` | 3,900 上下 | 隐藏对象，EMF 里没有图元；HTML 有构造但没几何量测 |
| `native_html_mapping_not_unique` | 1,500 上下 | 对象与 HTML 步骤、EMF 图元无法唯一对应（重合点、同名构造） |
| `ambiguous_translation` / `ambiguous_primitives` | 700 上下 | 拟合平移量或图元归属有歧义 |
| `geometry_matcher_not_yet_implemented` | 约 800 | 匹配器还没写 7、11–14、79–83、93 的预测，这些对象本身可断言 |

按约束看，未断言的 A 组对象集中在 2（线段，15,833）、15（路径点，5,099）、0（自由点，4,401）、9（线线交点，4,171）、8（多边形，3,029）。

## 3. 这个数字应该怎么读

- **能断言的部分已经 100% 通过**（2,232/2,232）。目前没有已知的几何偏差。
- **不能据此宣称「A 组对象在全语料上与 EMF 一致」**：83,061 个对象没有期望值，其中约 91% 卡在父对象所属的组。
- M2 的验收门槛建议改写成两句：**可断言集合全部通过（当前达成）**；**可断言集合的占比随 C/D 组推进而上升**，每轮记录一次占比。用「A 组 25 类全部有卡片 + 已实现类型全部通过断言」代替「全语料一致」更可核查。
- 隐藏对象永远不会有 EMF 期望，只能用 HTML 构造文本或原版度量对话框补足，属于另一套证据（见 Q4）。
