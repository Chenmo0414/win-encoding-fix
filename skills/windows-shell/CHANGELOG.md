# windows-shell 更新日志

版本号与 `SKILL.md` frontmatter 的 `version` 严格一致，由测试看守；
发布脚本按版本号从本文件提取对应段落作为 changelog。

## 4.2.0

修复 setup-env 的 Windows 用户级环境变量根本没设成功的 bug（嵌套双引号被 cmd.exe 吞掉）；
SKILL.md 补充 GBK 遗留文件读取、UTF-8 BOM、Out-File 默认 UTF-16、stdin/InputEncoding、
原始字节工具等编码陷阱；CLI 支持多盘 OpenClaw、失败时退出非零、参数解析健壮化；
测试全程隔离 HOME 并大幅提升覆盖。
