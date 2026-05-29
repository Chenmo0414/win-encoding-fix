#!/usr/bin/env node
/**
 * Self-contained coverage tests for bin/cli.js — no external deps.
 * Runs the CLI as a child process against isolated temp dirs so it never
 * touches the user's real ~/.claude, ~/.bash_profile, or global git config.
 *
 *   node test/cli.test.js
 */

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const CLI = path.join(__dirname, '..', 'bin', 'cli.js')
const SKILL_SRC = path.join(__dirname, '..', 'SKILL.md')
const SKILL_NAME = 'windows-shell'

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

function runCli(args, extraEnv = {}) {
  // Redirect HOME and git global config into temp so the CLI cannot mutate
  // the real environment during tests.
  const env = { ...process.env, ...extraEnv }
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { stdout, code: 0 }
  } catch (err) {
    // CLI never exits non-zero today, but capture defensively.
    return { stdout: (err.stdout || '') + (err.stderr || ''), code: err.status }
  }
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
}

console.log('\nwin-encoding-fix CLI tests\n')

// --- SKILL.md frontmatter (ClawHub publish requirements) ---

test('SKILL.md has name, version (semver), description frontmatter', () => {
  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  const fm = src.match(/^---\n([\s\S]*?)\n---/)
  assert(fm, 'frontmatter block missing')
  const block = fm[1]
  assert(/\nname:\s*\S+/.test('\n' + block), 'name missing')
  assert(/\ndescription:\s*\S+/.test('\n' + block), 'description missing')
  const ver = block.match(/\bversion:\s*([0-9]+\.[0-9]+\.[0-9]+)/)
  assert(ver, 'version missing or not semver')
})

test('package.json version matches SKILL.md version', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'))
  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  const ver = src.match(/\bversion:\s*([0-9.]+)/)[1]
  assert.strictEqual(pkg.version, ver, `pkg ${pkg.version} != skill ${ver}`)
})

// --- help ---

test('help lists all commands and options', () => {
  const { stdout } = runCli(['--help'])
  for (const token of ['install', 'uninstall', 'setup-env', '--claude', '--codex', '--openclaw', '--setup-env']) {
    assert(stdout.includes(token), `help missing ${token}`)
  }
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

  // Content must be byte-identical to source.
  const src = fs.readFileSync(SKILL_SRC, 'utf-8')
  assert.strictEqual(fs.readFileSync(claudeSkill, 'utf-8'), src, 'claude content differs')
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

test('uninstall on a clean target reports skip, does not crash', () => {
  const root = mkTmp('wef-uninstall2-')
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(stdout.includes('not installed') || stdout.includes('[skip]'), 'no skip message')
  rmrf(root)
})

// --- unknown command ---

test('unknown command falls back to help', () => {
  const { stdout } = runCli(['bogus-cmd'])
  assert(stdout.includes('Unknown command'), 'no unknown-command notice')
  assert(stdout.includes('Usage'), 'help not shown')
})

// --- setup-env (isolated HOME + git config) ---

test('setup-env writes bash_profile, makes .bashrc source it, sets git config', () => {
  const home = mkTmp('wef-home-')
  const gitConfig = path.join(home, '.gitconfig-test')
  const { stdout } = runCli(['setup-env'], {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitConfig,
    WIN_ENCODING_FIX_SKIP_WINENV: '1'
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

test('setup-env is idempotent (no duplicate exports on re-run)', () => {
  const home = mkTmp('wef-home2-')
  const gitConfig = path.join(home, '.gitconfig-test')
  const env = { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: gitConfig, WIN_ENCODING_FIX_SKIP_WINENV: '1' }
  runCli(['setup-env'], env)
  const { stdout } = runCli(['setup-env'], env)

  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  const occurrences = (profile.match(/PYTHONUTF8=1/g) || []).length
  assert.strictEqual(occurrences, 1, `PYTHONUTF8 duplicated ${occurrences}x`)
  assert(stdout.includes('already configured'), 'second run did not detect existing config')

  const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf-8')
  const rcCount = (rc.match(/&& \. ~\/\.bash_profile/g) || []).length
  assert.strictEqual(rcCount, 1, `.bashrc source line duplicated ${rcCount}x`)
  rmrf(home)
})

test('install --setup-env runs both phases', () => {
  const root = mkTmp('wef-both-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(
    ['install', '--setup-env', `--claude=${claude}`],
    { HOME: home, USERPROFILE: home, GIT_CONFIG_GLOBAL: path.join(home, '.gc'), WIN_ENCODING_FIX_SKIP_WINENV: '1' }
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
