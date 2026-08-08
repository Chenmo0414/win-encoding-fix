#!/usr/bin/env node
/**
 * Self-contained coverage tests for bin/cli.js — no external deps.
 *
 * SAFETY: every runCli invocation runs against an isolated temp HOME with
 * OPENCLAW_HOME pointed into that temp and git global config redirected, so a
 * test can NEVER touch the real ~/.claude, ~/.codex, ~/.openclaw, ~/.bash_profile
 * or the user's global git config — even the default-detection tests.
 *
 *   node test/cli.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CLI = path.join(__dirname, '..', 'bin', 'cli.js')
const SKILL_NAME = 'windows-shell'
const SKILL_SRC = path.join(__dirname, '..', 'skills', SKILL_NAME, 'SKILL.md')

let passed = 0
let failed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    failures.push({ name, err })
    console.log(`  ✗ ${name}\n      ${err.message.split('\n')[0]}`)
  }
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// Run the CLI. By default it is fully isolated: HOME/USERPROFILE point at a
// throwaway temp dir, OPENCLAW_HOME points into it (so detectOpenclaw's drive
// scan can't reach a real .openclaw unless a caller opts in), git global config
// is redirected, and the Windows-User-env branch is skipped. Pass
// { isolate: false } only for the SKILL.md-frontmatter/help tests that spawn no
// filesystem side effects. Pass extraEnv to override individual vars.
function runCli(args, opts = {}) {
  const { isolate = true, extraEnv = {} } = opts
  let home = opts.home
  let cleanupHome = false
  const baseEnv = { ...process.env }

  if (isolate) {
    if (!home) { home = mkTmp('wef-iso-'); cleanupHome = true }
    Object.assign(baseEnv, {
      HOME: home,
      USERPROFILE: home,
      OPENCLAW_HOME: path.join(home, '.no-openclaw'),
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig-test'),
      WIN_ENCODING_FIX_SKIP_WINENV: '1',
      WIN_ENCODING_FIX_NO_DRIVE_SCAN: '1'
    })
  }
  const env = { ...baseEnv, ...extraEnv }

  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { stdout, code: 0, home }
  } catch (err) {
    return { stdout: (err.stdout || '') + (err.stderr || ''), code: err.status, home }
  } finally {
    if (cleanupHome && !opts.keepHome) rmrf(home)
  }
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
}

console.log('\nwin-encoding-fix CLI tests\n')

// --- SKILL.md frontmatter (ClawHub publish requirements) ---

test('SKILL.md has name, version (semver), description, license frontmatter', () => {
  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  const fm = src.match(/^---\n([\s\S]*?)\n---/)
  assert(fm, 'frontmatter block missing')
  const block = fm[1]
  assert(/\nname:\s*\S+/.test('\n' + block), 'name missing')
  assert(/\ndescription:\s*\S+/.test('\n' + block), 'description missing')
  assert(/\nlicense:\s*\S+/.test('\n' + block), 'license missing')
  const ver = block.match(/\bversion:\s*([0-9]+\.[0-9]+\.[0-9]+)/)
  assert(ver, 'version missing or not semver')
})

// Replaces the old `pkg.version === SKILL.md version` assertion. That coupling
// is structurally impossible once the repo holds N independently-versioned
// skills — and it was the wrong invariant anyway: it is what forced a CLI-only
// change to bump the skill's version. The real cross-file identity is
// slug == directory name == frontmatter name, which is what protects the
// already-published ClawHub slug.
test('every skill frontmatter name equals its directory name', () => {
  const { listSkills, readMeta } = require(path.join(__dirname, '..', 'lib', 'skills'))
  const skills = listSkills()
  assert(skills.length > 0, 'no skills discovered')
  for (const skill of skills) {
    assert.strictEqual(readMeta(skill).name, skill.slug, `${skill.slug}: frontmatter name mismatch`)
  }
})

test('windows-shell CHANGELOG top section matches its frontmatter version', () => {
  const { parseFrontmatter } = require(path.join(__dirname, '..', 'lib', 'skills'))
  const dir = path.join(__dirname, '..', 'skills', SKILL_NAME)
  const version = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8')).version
  const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf-8')
  const head = changelog.match(/^## (\d+\.\d+\.\d+)$/m)
  assert(head, 'CHANGELOG.md has no "## x.y.z" heading')
  assert.strictEqual(head[1], version, `CHANGELOG head ${head[1]} != frontmatter ${version}`)
})

test('SKILL.md body keeps its 8 numbered rules and setup section (truncation guard)', () => {
  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  for (let n = 1; n <= 8; n++) {
    assert(new RegExp(`### 规则 ${n}`).test(src), `missing 规则 ${n}`)
  }
  assert(src.includes('## 环境前置条件'), 'missing 环境前置条件 section')
})

// --- help ---

test('help lists all commands and options', () => {
  const { stdout } = runCli(['--help'], { isolate: false })
  for (const token of ['install', 'uninstall', 'setup-env', '--claude', '--codex', '--openclaw', '--setup-env']) {
    assert(stdout.includes(token), `help missing ${token}`)
  }
})

test('-h aliases to help', () => {
  const { stdout } = runCli(['-h'], { isolate: false })
  assert(stdout.includes('Usage'), '-h did not show help')
})

// --- install to custom paths ---

test('install --claude/--codex/--openclaw copies SKILL.md to all three', () => {
  const root = mkTmp('wef-install-')
  const claude = path.join(root, 'claude')
  const codex = path.join(root, 'codex')
  const openclaw = path.join(root, 'openclaw')
  const { stdout } = runCli([
    'install',
    `--claude=${claude}`,
    `--codex=${codex}`,
    `--openclaw=${openclaw}`
  ])

  const claudeSkill = path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')
  const codexSkill = path.join(codex, 'skills', SKILL_NAME, 'SKILL.md')
  const openclawSkill = path.join(openclaw, 'workspace', 'skills', SKILL_NAME, 'SKILL.md')

  assert(fs.existsSync(claudeSkill), 'claude SKILL.md not written')
  assert(fs.existsSync(codexSkill), 'codex SKILL.md not written')
  assert(fs.existsSync(openclawSkill), 'openclaw SKILL.md not written')
  assert(stdout.includes('Installed to 3 target(s).'), 'count message wrong')

  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  assert.strictEqual(fs.readFileSync(claudeSkill, 'utf-8'), src, 'claude content differs')
  rmrf(root)
})

test('install accepts the space-separated --claude form', () => {
  const root = mkTmp('wef-space-')
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(['install', '--claude', claude, '--openclaw', path.join(root, 'oc')])
  assert(fs.existsSync(path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')), 'space-form --claude ignored')
  assert(!stdout.includes('Unknown command'), 'space-form arg misread as command')
  rmrf(root)
})

test('install is idempotent (re-running overwrites cleanly)', () => {
  const root = mkTmp('wef-idem-')
  const claude = path.join(root, 'claude')
  runCli(['install', `--claude=${claude}`])
  const { stdout } = runCli(['install', `--claude=${claude}`])
  assert(stdout.includes('[ok]'), 'second install did not report ok')
  assert(fs.existsSync(path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')))
  rmrf(root)
})

// --- default target detection (isolated so it can't touch real dirs) ---

test('default detection resolves claude/codex under HOME and finds OPENCLAW_HOME', () => {
  const home = mkTmp('wef-detect-')
  // Create an OpenClaw root that OPENCLAW_HOME points at.
  const ocSkills = path.join(home, 'oc', 'workspace', 'skills', SKILL_NAME)
  fs.mkdirSync(path.dirname(ocSkills), { recursive: true })
  const { stdout } = runCli(['install'], {
    home,
    keepHome: true,
    extraEnv: { OPENCLAW_HOME: path.join(home, 'oc') }
  })

  assert(fs.existsSync(path.join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md')), 'claude default not written')
  assert(fs.existsSync(path.join(home, '.codex', 'skills', SKILL_NAME, 'SKILL.md')), 'codex default not written')
  assert(fs.existsSync(path.join(ocSkills, 'SKILL.md')), 'OPENCLAW_HOME target not written')
  assert(stdout.includes('Installed to 3 target(s).'), 'expected 3 targets')
  rmrf(home)
})

test('install reports [skip] and lower count when OpenClaw is not detected', () => {
  // Isolated HOME with OPENCLAW_HOME pointing at a nonexistent dir -> no openclaw.
  const { stdout } = runCli(['install'])
  assert(stdout.includes('[skip] openclaw — not detected'), 'openclaw skip not reported')
  assert(stdout.includes('Installed to 2 target(s).'), 'expected 2 targets (claude+codex)')
})

// --- exit codes ---

test('install exits non-zero when a target hard-fails', () => {
  const root = mkTmp('wef-fail-')
  // Point a custom target under a regular FILE so mkdir throws ENOTDIR.
  const blocker = path.join(root, 'blocker')
  fs.writeFileSync(blocker, 'x')
  const { code, stdout } = runCli(['install', `--claude=${path.join(blocker, 'nested')}`])
  assert(stdout.includes('[fail]'), 'expected a [fail] line')
  assert.strictEqual(code, 1, `expected exit 1 on failure, got ${code}`)
  rmrf(root)
})

test('unknown command exits non-zero', () => {
  const { stdout, code } = runCli(['bogus-cmd'])
  assert(stdout.includes('Unknown command'), 'no unknown-command notice')
  assert(stdout.includes('Usage'), 'help not shown')
  assert.strictEqual(code, 1, `expected exit 1, got ${code}`)
})

test('no-arg invocation defaults to install', () => {
  const { stdout } = runCli([])
  assert(stdout.includes('Installing skill files'), 'bare invocation did not default to install')
})

// --- uninstall ---

test('uninstall removes the installed SKILL.md', () => {
  const root = mkTmp('wef-uninstall-')
  const claude = path.join(root, 'claude')
  runCli(['install', `--claude=${claude}`])
  const skill = path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')
  assert(fs.existsSync(skill), 'precondition: installed')

  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(!fs.existsSync(skill), 'SKILL.md still present after uninstall')
  assert(stdout.includes('removed') || stdout.includes('[ok]'), 'no removal message')
  rmrf(root)
})

test('uninstall removes SKILL.md but keeps a dir that holds other files', () => {
  const root = mkTmp('wef-keep-')
  const claude = path.join(root, 'claude')
  const dir = path.join(claude, 'skills', SKILL_NAME)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(SKILL_SRC, path.join(dir, 'SKILL.md'))
  fs.writeFileSync(path.join(dir, 'other.txt'), 'keep me')

  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(!fs.existsSync(path.join(dir, 'SKILL.md')), 'SKILL.md not removed')
  assert(fs.existsSync(path.join(dir, 'other.txt')), 'unrelated file was deleted')
  assert(/directory kept/.test(stdout), 'message did not disclose the dir was kept')
  rmrf(root)
})

test('uninstall on a clean target reports skip, does not crash', () => {
  const root = mkTmp('wef-uninstall2-')
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(stdout.includes('not installed') || stdout.includes('[skip]'), 'no skip message')
  rmrf(root)
})

// --- setup-env (isolated HOME + git config) ---

test('setup-env writes bash_profile, makes .bashrc source it, sets git config', () => {
  const home = mkTmp('wef-home-')
  const gitConfig = path.join(home, '.gitconfig-test')
  const { stdout } = runCli(['setup-env'], {
    home,
    keepHome: true,
    extraEnv: { GIT_CONFIG_GLOBAL: gitConfig }
  })

  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  assert(profile.includes('PYTHONUTF8=1'), 'bash_profile missing PYTHONUTF8')
  assert(profile.includes('PYTHONIOENCODING=utf-8'), 'bash_profile missing PYTHONIOENCODING')

  const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf-8')
  assert(rc.includes('.bash_profile'), '.bashrc does not source .bash_profile')

  assert(fs.existsSync(gitConfig), 'git global config not written')
  const gc = fs.readFileSync(gitConfig, 'utf-8')
  assert(/quotepath\s*=\s*false/.test(gc), 'git quotepath not set')
  assert(stdout.includes('git config'), 'no git config message')
  rmrf(home)
})

test('setup-env appends to an existing bash_profile, preserving its content', () => {
  const home = mkTmp('wef-append-')
  fs.writeFileSync(path.join(home, '.bash_profile'), '# my existing config\nalias ll="ls -la"\n')
  const { stdout } = runCli(['setup-env'], { home, keepHome: true })
  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  assert(profile.includes('alias ll='), 'existing content lost')
  assert(profile.includes('PYTHONUTF8=1'), 'encoding vars not appended')
  assert(stdout.includes('appended encoding vars'), 'append not reported')
  rmrf(home)
})

test('setup-env is idempotent (no duplicate exports on re-run)', () => {
  const home = mkTmp('wef-home2-')
  runCli(['setup-env'], { home, keepHome: true })
  const { stdout } = runCli(['setup-env'], { home, keepHome: true })

  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  const occurrences = (profile.match(/PYTHONUTF8=1/g) || []).length
  assert.strictEqual(occurrences, 1, `PYTHONUTF8 duplicated ${occurrences}x`)
  assert(stdout.includes('already configured'), 'second run did not detect existing config')

  const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf-8')
  const rcCount = (rc.match(/&& \. ~\/\.bash_profile/g) || []).length
  assert.strictEqual(rcCount, 1, `.bashrc source line duplicated ${rcCount}x`)
  rmrf(home)
})

test('setup-env block-marker detection triggers even if user pre-set PYTHONUTF8 elsewhere', () => {
  const home = mkTmp('wef-marker-')
  // User already exported PYTHONUTF8 by other means, but no win-encoding-fix block.
  fs.writeFileSync(path.join(home, '.bash_profile'), 'export PYTHONUTF8=1\n')
  runCli(['setup-env'], { home, keepHome: true })
  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  // The block (and thus LANG/LESSCHARSET) must still be added.
  assert(profile.includes('# win-encoding-fix:'), 'block marker not added')
  assert(profile.includes('LANG=en_US.UTF-8'), 'LANG not added despite pre-set PYTHONUTF8')
  rmrf(home)
})

test('setup-env survives git config failure without throwing', () => {
  const home = mkTmp('wef-gitfail-')
  // Point git global config at a directory so every write fails.
  const badGit = path.join(home, 'gitdir')
  fs.mkdirSync(badGit, { recursive: true })
  const { stdout } = runCli(['setup-env'], {
    home,
    keepHome: true,
    extraEnv: { GIT_CONFIG_GLOBAL: badGit }
  })
  // bash_profile should still be written; git line should report failure, not lie.
  assert(fs.existsSync(path.join(home, '.bash_profile')), 'bash_profile not written')
  assert(/git config/.test(stdout), 'no git config status line')
  rmrf(home)
})

test('install --setup-env runs both phases', () => {
  const root = mkTmp('wef-both-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(
    ['install', '--setup-env', `--claude=${claude}`],
    { home, keepHome: true, extraEnv: { GIT_CONFIG_GLOBAL: path.join(home, '.gc') } }
  )
  assert(fs.existsSync(path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')), 'skill not installed')
  assert(stdout.includes('Environment Setup'), 'setup-env phase did not run')
  rmrf(root)
})

// --- summary ---

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  for (const f of failures) {
    console.log(`FAIL: ${f.name}`)
    console.log(f.err.stack || f.err.message)
    console.log('')
  }
  process.exit(1)
}
