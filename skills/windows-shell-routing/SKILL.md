---
name: windows-shell-routing
version: 1.0.0
description: "Windows 上 AI agent 的 shell 选型规范：默认走 Git Bash，只在明确边界处单条命令切到 PowerShell 或 WSL。给出 12 类任务的 shell 归属、必须切 PowerShell 的四类、WSL 值不值得上的判定，以及 Git Bash 的五个坑及规避写法。适用于在 Windows 10/11 上做 JS/TS、Python 等开发的 agent 会话；选定 shell 之后的编码处理见 windows-shell skill。"
license: MIT
metadata:
  openclaw:
    emoji: "🐚"
    os: [windows]
---

# Windows 上优先用 Git Bash

**默认规则：在 Windows 上执行开发命令，一律先用 Git Bash。** 只有命中下面明确列出的边界时，才切到 PowerShell 或 WSL——并且是**单条命令切过去**，不是整个会话搬家。

本规范只管「该用哪个 shell」。选定之后怎么处理编码，见 `windows-shell` skill。

## 为什么默认 Git Bash

四个独立 agent 在同一台 Windows 10 机器上做同一份任务（zod + TypeScript + vitest，pydantic + pytest，共 9 步），每个只准用一种 shell。实测结果：

| 执行方式 | 输出 token | 轮次 | 失败 | 重试 | 三道闸门 |
|------|------|------|------|------|------|
| **Git Bash** | **8,114（基准）** | **34** | **0** | **0** | 全过 |
| WSL → `/mnt/d` | 11,543（1.42x） | 34 | 0 | 1（静默） | 全过 |
| WSL → ext4 | 15,159（1.87x） | 49 | 1 | 2 | 全过 |
| pwsh 7 | 18,808（**2.32x**） | 46 | 0 | 0 | 全过 |

另一组 12 个典型场景的合成基准独立复现了同一系数：PowerShell 5.1 的输出体积是 POSIX 的 **2.22 倍**（同一个「文件不存在」错误，POSIX 是 50 字节一行，PS 5.1 是 370 字节七行）。

命令启动开销（中位数，发 100 条命令的累计代价）：

| Git Bash | `wsl.exe` | PowerShell 5.1 | pwsh 7 |
|------|------|------|------|
| 0.064s（6.4s） | 0.130s（13.0s） | 0.189s（18.9s） | 0.216s（21.6s） |

三条结论：

- **Git Bash 是唯一零失败零重试的一臂**，且 token 最省。
- **PowerShell 不是「更容易出错」，而是「更啰嗦」**——它同样零失败，但写同样的东西用了 80 条语句（Git Bash 38 条），错误对象带调用栈、字符位置、CategoryInfo、FullyQualifiedErrorId 一起打印。
- **token 消耗与文件系统快慢无关，只与踩坑次数有关**：跑在最快的 ext4 上那一臂，因为踩了两个 `wsl.exe` 的坑、多花 15 轮，反而 token 最高。

## 决策表

| 你要做的事 | 用哪个 | 理由 |
|------|------|------|
| npm / pnpm / node / npx / tsc / vitest / jest | **Git Bash** | 直通，零摩擦 |
| python / pip / venv / pytest | **Git Bash** | 直通（venv 见下方坑 3） |
| git 全套 | **Git Bash** | 原生，且 worktree 在 WSL 里根本用不了 |
| **native 模块编译**（node-gyp + MSVC） | **Git Bash** | 与 pwsh **完全等价**：产物字节数相同，都经 vswhere 找到同一套 VS 工具链 |
| ssh / scp / git over ssh | **Git Bash** | 与 Windows 共用 `~/.ssh`，密钥无需 chmod（见坑 5） |
| curl / grep / sed / awk / find / jq* | **Git Bash** | POSIX 工具链（`jq` 需另装，见坑 4） |
| Windows 服务、注册表、事件日志、计划任务、证书 | **PowerShell** | Git Bash 没有对应能力 |
| 需要 .NET 类型 / COM 对象 / 对象管道 | **PowerShell** | 硬边界，无替代 |
| 需要管理员权限 | **交给人做** | UAC 弹窗 agent 点不了，命令会挂死 |
| 跑 Makefile / 需要 gcc、rsync | **WSL** | Git Bash 的 MSYS2 工具集撑不住 |
| 重 I/O 的构建（大型 monorepo 反复编译） | **WSL + 项目放 ext4** | 见下方「什么时候才值得上 WSL」 |

## 必须切 PowerShell 的四类

这四类没有 Git Bash 替代品，别硬试：

1. **Windows 系统层面** —— `Get-Service` / `Get-ScheduledTask` / `Get-WinEvent` / `Get-NetTCPConnection` / 证书存储 / 注册表写入。
2. **.NET 与 COM** —— `[System.Guid]::NewGuid()`、`New-Object -ComObject`、任何 `[类型]::方法()` 调用。
3. **对象管道** —— 需要 `Select-Object Id,WS` 这种结构化字段筛选，而不是文本切割时。
4. **提权操作** —— 但注意：**这类应该交给人执行**。Git Bash 没有 `sudo`，唯一提权路径是 `Start-Process -Verb RunAs`，它会弹 UAC，agent 无法点击，命令就一直挂着。需要管理员权限的步骤，写进说明让人来做，不要让 agent 去试。

切过去的正确写法是**单条命令**，不是切换会话：

```bash
# 在 Git Bash 里调一条 PowerShell，用完即回
powershell -NoProfile -Command '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Service wuauserv).Status'
```

外层务必单引号（防 bash 展开 `$_`、`$null`），UTF-8 前缀对 PS 5.1 必需——细节见 `windows-shell` skill 规则 1。

## 什么时候才值得上 WSL

WSL 的优势只有一个来源：**ext4 原生文件系统**。而它成立的前提是**项目文件真的放在 ext4 里**。

| 操作 | ext4（WSL 原生） | NTFS（Windows 原生） | `/mnt/*`（WSL 访问 Windows 盘） |
|------|------|------|------|
| tsc 类型检查 | 1.00x | 1.52x | **4.93x** |
| vitest | 1.00x | 2.36x | **9.69x** |
| 3000 个小文件增删查 | 1.00x | 8.96x | **54.2x** |

**判定规则：**

- 项目在 `C:\` / `D:\` 上 → **不要用 WSL 操作它**。`/mnt/*` 走 9p 协议逐文件跨界，比纯 Windows 还慢 4–6 倍，而且惩罚随项目规模线性放大（文件数 ×3.5，惩罚 ×2）。小 demo 上试不出来，真项目上卡死。
- 项目能整个搬进 WSL 的 `~/` 且构建密集 → 值得，编译测试全项最快。
- 只是想跑 `make`、`gcc`、`rsync` → 值得，但记得项目也要在 ext4。
- 其它情况 → 留在 Git Bash。

**用 WSL 时必须知道的两件事：**

```bash
# 1) 不要用 wsl.exe -- bash -c '<脚本>' 传复杂脚本
#    wsl.exe 会用 WSL 登录环境预展开变量，脚本内定义的变量被吞成空，且退出码仍为 0
wsl.exe -d Ubuntu -- bash -c 'i=3; echo "$((i+1))"'   # → 1（错误数字，无报错）

# 正确：走 stdin
wsl.exe -d Ubuntu -- bash -s <<'EOF'
i=3; echo "$((i+1))"                                   # → 4
EOF

# 2) 命令先落盘再取退出码，别指望行内 echo
#    进度条的回车符经 wsl.exe 回传时会互相覆盖，echo $? 整行可能消失
wsl.exe -d Ubuntu -- bash -s <<'EOF'
npx vitest run > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t.log
EOF
```

另外：**git worktree 在 WSL 里完全不可用**——`.git` 文件里存的是 `D:/...` 盘符路径，Linux 的 git 解析不了，直接 fatal。

## Git Bash 的五个坑

选了 Git Bash，这五个必须知道，否则会以为是代码的问题。

### 坑 1：以 `/` 开头的参数会被改写（静默）

MSYS2 把它们当 Unix 路径转成 Windows 路径再传给程序。**不报错、退出码正常、参数已经变了**：

```bash
node app.js /api/v1/users     # 程序收到 D:/Program Files/Git/api/v1/users
prog /S /C                    # → S:/ C:/
docker run -v /app:/app ...   # -v 后面被吃掉
```

```bash
# 解法：单条命令前置，别全局导出
MSYS_NO_PATHCONV=1 node app.js /api/v1/users
```

全局导出会让 `/c/Users/...` 这类你确实希望被转换的参数也不转了。

### 坑 2：`ln -s` 默认产出的是副本

```bash
ln -s t.txt l.txt && ls -l l.txt      # -rw-r--r--  ← 是副本，不是链接
export MSYS=winsymlinks:nativestrict  # 修复后 → lrwxrwxrwx
```

**pnpm workspace、npm link、monorepo 本地依赖都依赖真符号链接**，退化成副本会表现为「改了源码不生效」。需先启用 Windows 开发者模式。

### 坑 3：venv 的 `activate` 会拼出畸形路径

```bash
source .venv/Scripts/activate    # VIRTUAL_ENV 丢盘符，路径变成 /d/proj/\proj\.venv/Scripts/python
```

虽然仍能解析，但不可靠。**直接调解释器，绕开 activate**：

```bash
./.venv/Scripts/python.exe -m pytest
./.venv/Scripts/python.exe -m pip install -r requirements.txt
```

### 坑 4：工具集不全

`jq`、`make`、`gcc`、`rsync` 都**没有**。跑 Makefile 的项目直接卡住——那种情况上 WSL，不要试图在 Git Bash 里凑。

### 坑 5：SSH 密钥位置与 WSL 不通用

Git Bash 与 Windows 共用 `C:\Users\你\.ssh`，**WSL 用的是独立的 `/root/.ssh`**。在 Windows 配好的 SSH，到 WSL 里等于从零开始。

而且 `/mnt/*` 上的文件在 WSL 眼里权限是 `777`，OpenSSH 会判定 `bad permissions` 直接忽略该密钥。要在 WSL 里用 ssh，密钥必须复制到 ext4 并 `chmod 600`。Git Bash 没有这个问题（它走 Windows ACL，不看 POSIX 权限位）。

### 附：管道会吞掉退出码

这不是 Git Bash 特有，但 agent 最容易在这里误判成功：

```bash
npm install ... | tail -25      # $? 是 tail 的，不是 npm 的
set -o pipefail                 # 或用 ${PIPESTATUS[0]}
```

## 反模式

| 别这样 | 该这样 |
|------|------|
| 因为「Windows 就该用 PowerShell」而默认 PowerShell | 默认 Git Bash，只在四类边界处单条切过去 |
| 为了性能把 Windows 盘上的项目改用 WSL 操作 | 要么整个搬进 ext4，要么留在 Git Bash。别跨 `/mnt/*` |
| 用小 demo 验证「WSL 访问 `/mnt` 快不快」 | 惩罚随规模放大，小项目试不出来 |
| 让 agent 尝试提权 | UAC 弹窗会挂死，写进说明让人做 |
| 遇到报错先怀疑编码 | 先分清：乱码 → 编码问题；语法错/找不到文件 → 参数被改写 |
| 整个会话切到 PowerShell 或 WSL | 单条命令切换，主线留在 Git Bash |

## 一句话总结

**Git Bash 做主力，PowerShell 管 Windows 系统层面，WSL 只在项目能整个住进 ext4 时才值得。** 三者是分工，不是替代——而分工的默认值应该是 Git Bash。
