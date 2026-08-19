# windows-shell-routing 更新日志

版本号与 `SKILL.md` frontmatter 的 `version` 严格一致，由测试看守；
发布脚本按版本号从本文件提取对应段落作为 changelog。

## 1.0.0

首个版本。Windows 上 AI agent 的 shell 选型规范：默认走 Git Bash，只在明确边界处
**单条命令**切到 PowerShell 或 WSL，主线不搬家。

与本工厂的 `windows-shell` 互补，不重叠——那个管「怎么正确执行命令」（编码），
这个管「该用哪个 shell」（选型）。选定之后的编码处理直接引用前者，不复述细节。
两者 18 个技术主题里只有 3 个交叉，且细节都落在 `windows-shell` 一侧。

依据来自同一台 Windows 10 机器上的四臂 agent 对照实验——四个独立 agent 做同一份任务
（zod + TypeScript + vitest，pydantic + pytest，共 9 步），每臂只准用一种 shell：

| 执行方式 | 输出 token | 轮次 | 失败 | 重试 |
|------|------|------|------|------|
| Git Bash | 8,114（基准） | 34 | 0 | 0 |
| WSL → `/mnt/d` | 11,543（1.42x） | 34 | 0 | 1（静默） |
| WSL → ext4 | 15,159（1.87x） | 49 | 1 | 2 |
| pwsh 7 | 18,808（2.32x） | 46 | 0 | 0 |

另有 12 场景合成基准独立复现同一系数（PS 5.1 输出体积是 POSIX 的 2.22 倍），
以及命令启动开销测量（Git Bash 0.064s / `wsl.exe` 0.130s / PS 5.1 0.189s / pwsh 7 0.216s）。

内容：

- **决策表**：12 类常见任务的 shell 归属。含一条反直觉结论——native 模块编译
  （node-gyp + MSVC）用 Git Bash 即可，与 pwsh **完全等价**：产物字节数相同，
  都经 vswhere 找到同一套 VS 工具链。
- **必须切 PowerShell 的四类**：系统层面、.NET/COM、对象管道、提权。其中提权明确标为
  「交给人做」——UAC 弹窗 agent 点不了，命令会一直挂着。
- **WSL 判定**：优势只来自 ext4，且前提是项目真的住在里面。跨 `/mnt/*` 比纯 Windows
  还慢 4–6 倍（vitest 9.69x、3000 小文件 54.2x），且惩罚随项目规模线性放大
  （文件数 ×3.5，惩罚 ×2），所以小 demo 上验证会得到偏乐观的错误答案。
  另附 `wsl.exe` 的两个必知坑：变量吞噬（`bash -c` 传脚本时 `$i` 被吞成空且退出码仍为 0）
  与 stdout 回传粘连（`echo $?` 整行消失）。
- **Git Bash 的五个坑**：参数改写（静默）、`ln -s` 退化成副本、venv `activate` 拼出
  正反斜杠混拼路径、工具集不全（无 jq/make/gcc/rsync）、SSH 密钥位置与 WSL 不通用
  （`/mnt/*` 上的密钥权限是 777，OpenSSH 判 `bad permissions` 直接忽略）。
- **反模式清单**。

所有现象均在本机实测复现；涉及稳定性的结论为多次采样，不是单次观察。
