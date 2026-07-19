#!/usr/bin/env bash
# Publish this skill to ClawHub.
#   1) clawhub login         (browser GitHub auth, account must be >= 1 week old)
#   2) bash scripts/publish-clawhub.sh
#
# Note: clawhub's publish resolves "." unreliably and reports "SKILL.md required",
# so we pass an absolute Windows-style path (cygpath/pwd -W).
set -euo pipefail

cd "$(dirname "$0")/.."

# Gate the publish on the test suite (version-sync + frontmatter + CLI coverage).
echo "Running tests before publish..."
npm test

# Absolute Windows path that node (clawhub) resolves correctly under Git Bash.
SKILL_DIR="$(cygpath -w "$PWD" 2>/dev/null || pwd -W 2>/dev/null || pwd)"

VERSION="$(grep -m1 '^version:' SKILL.md | sed 's/version:[[:space:]]*//' | tr -d '\r')"

echo "Publishing windows-shell@${VERSION} from ${SKILL_DIR}"

clawhub skill publish "${SKILL_DIR}" \
  --slug windows-shell \
  --name "windows-shell" \
  --version "${VERSION}" \
  --changelog "v${VERSION} —— 修复 setup-env 的 Windows 用户级环境变量根本没设成功的 bug（嵌套双引号被 cmd.exe 吞掉）；SKILL.md 补充 GBK 遗留文件读取、UTF-8 BOM、Out-File 默认 UTF-16、stdin/InputEncoding、原始字节工具等编码陷阱；CLI 支持多盘 OpenClaw、失败时退出非零、参数解析健壮化；测试全程隔离 HOME 并大幅提升覆盖。" \
  --clawscan-note "仅含 SKILL.md / README.md / LICENSE 文档，无可执行逻辑。" \
  --tags latest --no-input
