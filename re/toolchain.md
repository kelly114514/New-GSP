# 分析工具与来源

- 复用本机 REA `6.5.0`：`C:\tools\rea\runtime\node_modules\rea-agents`。
- 在 `re/tools` 内准备便携 UPX `5.2.1`、Ghidra `12.1.4` 和 Temurin JDK `21.0.12.1+1`，没有写入系统 PATH 或修改 Codex MCP 配置。REA 调用 Ghidra 的变量仅对分析子进程生效。
- UPX 用于读取压缩程序并生成独立的解包件；Ghidra、CFR 和 javap 用于静态代码分析，没有调用目标程序入口。
- 本机保留 `tools` 中已解压的可用工具链；重复的下载压缩包已清理。仓库保留 `*-release.json` 和本表中的压缩包校验值，不提交工具安装目录。需要重新部署时可按记录来源重取，并核对 UPX/Ghidra 的 GitHub asset digest 与 JDK 的 Adoptium package checksum。

| 工具压缩包 | SHA-256 |
| --- | --- |
| `upx.zip` | `eabc6792a347d45e945be7748423e7868fd01b0d2bcaa2f4b1031fd71ff69bda` |
| `ghidra.zip` | `ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db` |
| `jdk.zip` | `f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e` |

来源：[UPX 官方发布](https://github.com/upx/upx/releases/tag/v5.2.1)、[Ghidra 官方发布](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build)、[Adoptium 官方 API](https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse)。JDK 实际下载的固定 URL 与校验值见 `tools/jdk-release.json`。

首次直接解析压缩主程序资源时，REA 严格解析器拒绝 `UPX1` 数据范围与声称 `SizeOfHeaders` 重叠。未修改头部来绕过检查；成功静态 UPX 解包后，REA 正常完成资源和原生分析。

Claude Code 通过根目录 `.mcp.json` → `re/rea-mcp.mjs` 启动 REA，Ghidra/JDK 路径由 `re/rea-env.mjs` 只对该子进程设置；`.claude/settings.json` 的 `enabledMcpjsonServers` 预先批准该服务。用法见 `re/README.md`。
