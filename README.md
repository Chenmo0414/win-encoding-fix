# skill-factory（Skill 工厂）

A small factory for AI-assistant skills. Each skill lives in its own directory under
`skills/`, and one zero-dependency CLI installs them into every assistant it can find —
Claude Code, Codex and OpenClaw.

The factory currently ships two skills, both measured on a real Windows 10
(code page 936/GBK) machine. They are complements, not alternatives: one picks the
shell, the other keeps you out of trouble once you are in it.

## Skills

| Skill | What it does |
|-------|--------------|
| [`windows-shell`](skills/windows-shell/SKILL.md) | **How to run a command correctly** — 10 rules covering GBK/UTF-8, BOM, MSYS2 argument rewriting, PowerShell/pwsh, Python, Node.js and Git |
| [`windows-shell-routing`](skills/windows-shell-routing/SKILL.md) | **Which shell to run it in** — default to Git Bash, with measured boundaries for switching to PowerShell or WSL |

They overlap on only 3 of 18 technical topics, and the detail always lives in
`windows-shell`; `windows-shell-routing` points at it rather than restating it.

One directory per skill under `skills/`. The **directory name is the skill's identity**:
it is simultaneously the ClawHub slug, the installed directory name, and the `name:` in
the skill's own frontmatter. The test suite enforces that all three agree, so they cannot
drift. There is no manifest file to keep in sync.

> **Careful:** `skills/` is also ClawHub's default managed directory. Do not run
> `clawhub install` or `clawhub update --force` from the repo root — `--force` deletes
> the target directory before unpacking, which would wipe a skill's source. The factory
> ignores any directory carrying `.clawhub/origin.json`, so a stray managed skill is
> never re-published or pushed into your `~/.claude`.

## Install

### ClawHub (recommended, per skill)

```bash
clawhub install windows-shell
```

### From a clone (all skills at once)

```bash
node bin/cli.js install --setup-env
```

### Manual

Copy a skill's directory to whichever assistants you use:

| Platform | Path |
|----------|------|
| Claude Code | `~/.claude/skills/<slug>/` |
| Codex | `~/.codex/skills/<slug>/` |
| OpenClaw | `~/.openclaw/workspace/skills/<slug>/` |

### npm

> **Not published to npm.** `win-encoding-fix` never was, and `skill-factory` is not yet.
> Use the ClawHub or clone install above. The `npx`/`-g` forms below only work after a
> publish.

```bash
npx skill-factory install --setup-env
npm install -g skill-factory
```

If you previously ran `npm i -g` from a clone of the old `win-encoding-fix` package,
remove it first (`npm rm -g win-encoding-fix`) — npm 7+ refuses to relink a bin that
belongs to a different package name. The `win-encoding-fix` bin name still works; it
points at the same CLI.

## Commands

```bash
skill-factory install                 # install every skill to every detected assistant
skill-factory install windows-shell   # install just one skill
skill-factory install --setup-env     # also configure the host machine (see below)
skill-factory list                    # list the skills in this factory
skill-factory uninstall               # remove installed skill files
skill-factory setup-env               # only configure the host machine
skill-factory --version

# Custom install paths (if not using the default locations)
skill-factory install --claude=D:\my-claude
skill-factory install --codex=E:\my-codex
skill-factory install --openclaw=E:\.openclaw
```

Naming no skill means every skill. A misspelled slug exits non-zero and lists what is
available — it is never a silent no-op.

## Host setup (`setup-env`)

`setup-env` configures the **machine**, not a skill. It is a Windows-encoding concern and
runs only when you ask for it, in three layers:

1. **Windows User environment variables** — `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`.
   Inherited by every process; takes effect after restarting the terminal.
2. **bash rc files** — the same vars plus `LANG`/`LESSCHARSET` in `~/.bash_profile`, with
   `~/.bashrc` sourcing it so non-login shells get them too.
3. **Global git config** — `core.quotepath=false`, `core.autocrlf=input`,
   `i18n.commitEncoding`/`i18n.logOutputEncoding=utf-8`, `core.pager="less -R"`.

Why all three: exports written to `~/.bash_profile` are only sourced by *login* shells.
AI assistants and scripts run in **non-interactive** shells that source neither
`.bash_profile` nor `.bashrc`, so `PYTHONUTF8=1` set there never reaches the Python the
agent actually runs (`sys.flags.utf8_mode` stays `0`). Layer 1 is what fixes that.

See [`skills/windows-shell/SKILL.md`](skills/windows-shell/SKILL.md) — section
`环境前置条件` — for the exact commands and the reasoning behind each one, plus the 10
rules themselves.

## Versioning

Two independent axes:

- **`package.json` version** — the factory and its CLI.
- **`skills/<slug>/SKILL.md` frontmatter `version`** — that skill's content.

They are unrelated on purpose: a CLI fix should not bump a skill's published version.
Each skill carries its own `CHANGELOG.md`, whose top `## x.y.z` heading must match its
frontmatter version — enforced by the test suite and by the publish script.

## Publishing a skill

```bash
bash scripts/publish-clawhub.sh windows-shell --dry-run   # inspect first
bash scripts/publish-clawhub.sh windows-shell
```

Edit `SKILL.md` → bump its frontmatter `version` → add the matching `## x.y.z` section to
that skill's `CHANGELOG.md` → `npm test` → dry-run and read it → publish. The publish unit
is the skill's own directory, so what is committed is exactly what ships.

## Layout

```
bin/cli.js          thin entry point (keep this path)
lib/cli.js          arg parsing, dispatch, all stdout
lib/skills.js       the registry: skills/*/SKILL.md discovery + frontmatter
lib/targets.js      where each assistant keeps its skills
lib/install.js      copy / remove one skill under one skills root
lib/setup-env.js    host-machine setup (Windows env vars, bash rc, git config)
skills/<slug>/      one skill: SKILL.md + CHANGELOG.md
test/               zero-dependency suite, run by test/run.js
```

## Testing

```bash
npm test
```

Zero dependencies, no test framework. Every case that spawns the CLI runs against a
throwaway `HOME` with `OPENCLAW_HOME` and `GIT_CONFIG_GLOBAL` redirected, so a test can
never touch your real `~/.claude`, `~/.bash_profile` or global git config.

## License

MIT
