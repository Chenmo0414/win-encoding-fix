# windows-shell 更新日志

版本号与 `SKILL.md` frontmatter 的 `version` 严格一致，由测试看守；
发布脚本按版本号从本文件提取对应段落作为 changelog。

## 4.4.0

新增 MSYS2 参数改写规则，并修正三处经复测证伪的旧结论。稳定性结论均为 12 次采样，
不再是单次观察。

修正：

- **pwsh 7 不再标注「输出可能乱码（实测不稳定）」**。实测 12/12 稳定 UTF-8。
  UTF-8 前缀只对 PS 5.1 必需；外部程序（node/python）的输出穿过 PowerShell 不会被改，
  两侧都不受影响。规则 1 改为一张按「中文来源 × 是否加前缀」划分的实测表。
- **`reg query` 移出编码禁用表**。它的失败是 MSYS2 把注册表路径当 Unix 路径改写
  （报「无效语法」而非乱码），加 `MSYS_NO_PATHCONV=1` 后原命令即可正常工作，与编码无关。
  规则 3 因此拆为 A 类（真编码问题：wmic/systeminfo/ipconfig/netstat/tasklist/net user）
  与 B 类（参数改写：reg query/findstr/schtasks），两类解法完全不同。
- **规则 4 补上前提**。配好用户级 `PYTHONUTF8` 后裸 `python -c` 已经正常；
  `-X utf8` 的价值在于不依赖环境（CI、容器、别人的机器），而非「不加必乱码」。
  附反证：清空该变量后 `getpreferredencoding` 立刻退回 `cp936`。

新增（原规则 6/7/8 顺延为 8/9/10）：

- **规则 6：MSYS2 会改写以 `/` 开头的参数**。`/api/v1/users` 被改写成
  `D:/Program Files/Git/api/v1/users`，`/S /C` 变成 `S:/ C:/`，Docker 的 `-v` 参数被吃掉。
  最坏的是它**静默生效**——不报错、退出码正常、参数已经变了。给出
  `MSYS_NO_PATHCONV` / `MSYS2_ARG_CONV_EXCL` / 双斜杠三种解法，并说明为什么不能全局导出
  （会让 `/c/Users/...` 这类本该转换的参数也不转）。
- **规则 7：`ln -s` 默认产出普通文件副本**，影响 pnpm workspace / npm link；
  `MSYS=winsymlinks:nativestrict` 可修，附开发者模式检查命令。

另新增开头的「两类问题，别混为一谈」判别小节（乱码 → 编码；语法错/找不到文件 → 参数改写），
并在「不需要包装的工具」白名单下注明：输出编码干净 ≠ 没坑。

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
