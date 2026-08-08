#!/usr/bin/env bash
# Publish ONE skill from this factory to ClawHub.
#
#   1) clawhub login                                    (browser GitHub auth, account must be >= 1 week old)
#   2) bash scripts/publish-clawhub.sh <slug> --dry-run (inspect what would be sent)
#   3) bash scripts/publish-clawhub.sh <slug>
#
# Run from Git Bash. Two things worth knowing:
#   - clawhub's publish resolves "." unreliably and reports "SKILL.md required",
#     so we pass an absolute Windows-style path (cygpath/pwd -W).
#   - the publish unit is the skill's own directory (skills/<slug>/), which is why
#     this repo has no .clawhubignore: nothing but the skill is in scope.
#
# The slug has NO default. A default would eventually publish the wrong skill
# under someone else's slug, and that is not reversible.
set -euo pipefail

cd "$(dirname "$0")/.."

SLUG="${1:-}"
if [ -z "$SLUG" ] || [ "${SLUG#-}" != "$SLUG" ]; then
  echo "Usage: bash scripts/publish-clawhub.sh <slug> [--dry-run]" >&2
  echo "" >&2
  echo "Available skills:" >&2
  for d in skills/*/; do
    [ -f "${d}SKILL.md" ] && echo "  $(basename "$d")" >&2
  done
  exit 1
fi

SKILL_SRC="skills/${SLUG}/SKILL.md"
if [ ! -f "$SKILL_SRC" ]; then
  echo "No such skill: ${SLUG} (expected ${SKILL_SRC})" >&2
  exit 1
fi

DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1

# Gate the publish on the test suite (skill contract + frontmatter + CLI coverage).
echo "Running tests before publish..."
npm test

VERSION="$(grep -m1 '^version:' "$SKILL_SRC" | sed 's/version:[[:space:]]*//' | tr -d '\r')"
if [ -z "$VERSION" ]; then
  echo "Could not read 'version:' from ${SKILL_SRC}" >&2
  exit 1
fi

# The changelog comes from the skill's own CHANGELOG.md, keyed by version — not
# from a string baked into this script. A hardcoded changelog silently ships the
# previous release's notes under the new version number.
CHANGELOG_FILE="skills/${SLUG}/CHANGELOG.md"
CHANGELOG="$(awk -v want="## ${VERSION}" '
  $0 == want { inside = 1; next }
  inside && /^## / { exit }
  inside { print }
' "$CHANGELOG_FILE" 2>/dev/null | sed -e '/./,$!d' | sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba')"

if [ -z "$CHANGELOG" ]; then
  echo "${CHANGELOG_FILE} has no \"## ${VERSION}\" section — add one before publishing." >&2
  exit 1
fi

# Absolute Windows path that node (clawhub) resolves correctly under Git Bash.
SKILL_DIR="$(cygpath -w "$PWD/skills/$SLUG" 2>/dev/null \
  || (cd "skills/$SLUG" && pwd -W) 2>/dev/null \
  || echo "$PWD/skills/$SLUG")"

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "--- dry run (nothing published) ---"
  echo "slug:    ${SLUG}"
  echo "version: ${VERSION}"
  echo "dir:     ${SKILL_DIR}"
  echo "files:"
  find "skills/$SLUG" -type f -not -path '*/.*' | sed 's/^/  /'
  echo "changelog:"
  echo "${CHANGELOG}" | sed 's/^/  /'
  exit 0
fi

echo "Publishing ${SLUG}@${VERSION} from ${SKILL_DIR}"

clawhub skill publish "${SKILL_DIR}" \
  --slug "${SLUG}" \
  --name "${SLUG}" \
  --version "${VERSION}" \
  --changelog "${CHANGELOG}" \
  --clawscan-note "仅含 SKILL.md / CHANGELOG.md 文档，无可执行逻辑。" \
  --tags latest --no-input
