# windows-shell 更新日志

版本号与 `SKILL.md` frontmatter 的 `version` 严格一致，由测试看守；
发布脚本按版本号从本文件提取对应段落作为 changelog。

## 4.3.0

修正「一键配置」那行：原文写的 `npx win-encoding-fix install --setup-env` 从来没能工作过
——该包从未发布到 npm，且 npx 解析的是包名而不是 bin 名。改为从仓库执行
`node bin/cli.js setup-env`。仓库已重构为 skill-factory（Skill 工厂）多技能布局，
本技能现位于 `skills/windows-shell/`；ClawHub slug、安装目录名与 frontmatter 的 name
仍然都是 `windows-shell`，未发生变化。bundle 内容现为 SKILL.md + CHANGELOG.md。
编码规则正文无改动。

## 4.2.0

修复 setup-env 的 Windows 用户级环境变量根本没设成功的 bug（嵌套双引号被 cmd.exe 吞掉）；
SKILL.md 补充 GBK 遗留文件读取、UTF-8 BOM、Out-File 默认 UTF-16、stdin/InputEncoding、
原始字节工具等编码陷阱；CLI 支持多盘 OpenClaw、失败时退出非零、参数解析健壮化；
测试全程隔离 HOME 并大幅提升覆盖。
