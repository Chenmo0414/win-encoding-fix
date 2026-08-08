'use strict'

// Install / uninstall, end to end through the CLI plus the pure file-set helper.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, runCli, mkTmp, rmrf, ROOT, FIXTURE_SKILLS } = require('./harness')
const { filesOf } = require('../lib/install')

console.log('--- install ---')

const SKILL_NAME = 'windows-shell'
const SKILL_DIR = path.join(ROOT, 'skills', SKILL_NAME)
const SKILL_SRC = path.join(SKILL_DIR, 'SKILL.md')

const FIXTURES = { extraEnv: { SKILL_FACTORY_SKILLS_DIR: FIXTURE_SKILLS } }

// --- install to custom paths ---

test('install --claude/--codex/--openclaw copies the skill to all three', () => {
  const root = mkTmp('sf-install-')
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
  const root = mkTmp('sf-space-')
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(['install', '--claude', claude, '--openclaw', path.join(root, 'oc')])
  assert(fs.existsSync(path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')), 'space-form --claude ignored')
  assert(!stdout.includes('Unknown command'), 'space-form arg misread as command')
  rmrf(root)
})

test('install is idempotent (re-running overwrites cleanly)', () => {
  const root = mkTmp('sf-idem-')
  const claude = path.join(root, 'claude')
  runCli(['install', `--claude=${claude}`])
  const { stdout } = runCli(['install', `--claude=${claude}`])
  assert(stdout.includes('[ok]'), 'second install did not report ok')
  assert(fs.existsSync(path.join(claude, 'skills', SKILL_NAME, 'SKILL.md')))
  rmrf(root)
})

// The local installer used to copy SKILL.md only, while `clawhub install` shipped
// the whole directory. install and uninstall now share filesOf(), so the two
// delivery channels agree by construction.
test('install copies the whole skill directory tree, not just SKILL.md', () => {
  const root = mkTmp('sf-tree-')
  const claude = path.join(root, 'claude')
  runCli(['install', 'beta', `--claude=${claude}`], FIXTURES)
  const dest = path.join(claude, 'skills', 'beta')
  assert(fs.existsSync(path.join(dest, 'SKILL.md')), 'SKILL.md missing')
  assert(fs.existsSync(path.join(dest, 'references', 'note.md')), 'nested reference file missing')
  rmrf(root)
})

test('filesOf excludes dot entries and node_modules', () => {
  const root = mkTmp('sf-filesof-')
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.mkdirSync(path.join(root, '.clawhub'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(root, 'SKILL.md'), 'x')
  fs.writeFileSync(path.join(root, 'sub', 'a.md'), 'x')
  fs.writeFileSync(path.join(root, '.clawhub', 'origin.json'), '{}')
  fs.writeFileSync(path.join(root, 'node_modules', 'junk.js'), 'x')
  fs.writeFileSync(path.join(root, '.hidden'), 'x')
  assert.deepStrictEqual(filesOf(root), ['SKILL.md', path.join('sub', 'a.md')])
  rmrf(root)
})

// --- slug selection ---

test('install <slug> installs only that slug', () => {
  const root = mkTmp('sf-oneslug-')
  const claude = path.join(root, 'claude')
  runCli(['install', 'alpha', `--claude=${claude}`], FIXTURES)
  const skills = path.join(claude, 'skills')
  assert(fs.existsSync(path.join(skills, 'alpha', 'SKILL.md')), 'alpha not installed')
  assert(!fs.existsSync(path.join(skills, 'beta')), 'beta installed despite not being named')
  rmrf(root)
})

test('unknown slug exits 1 and lists the available slugs', () => {
  const root = mkTmp('sf-badslug-')
  const claude = path.join(root, 'claude')
  const { stdout, code } = runCli(['install', 'windwos-shell', `--claude=${claude}`], FIXTURES)
  assert.strictEqual(code, 1, `expected exit 1, got ${code}`)
  assert(stdout.includes('Unknown skill: windwos-shell'), 'the bad slug was not named')
  assert(/Available: alpha, beta/.test(stdout), 'available slugs not listed')
  assert(!fs.existsSync(path.join(claude, 'skills')), 'it installed something anyway')
  rmrf(root)
})

test('two skills to two targets writes four directories and reports 2 target(s)', () => {
  const root = mkTmp('sf-count-')
  const claude = path.join(root, 'claude')
  const codex = path.join(root, 'codex')
  const { stdout } = runCli(['install', `--claude=${claude}`, `--codex=${codex}`], FIXTURES)
  for (const base of [claude, codex]) {
    for (const slug of ['alpha', 'beta']) {
      assert(fs.existsSync(path.join(base, 'skills', slug, 'SKILL.md')), `${base}/${slug} missing`)
    }
  }
  // Counted by distinct TARGET, not by skill x target pairs.
  assert(stdout.includes('Installed to 2 target(s).'), `count message wrong:\n${stdout}`)
  rmrf(root)
})

// --- default target detection (isolated so it can't touch real dirs) ---

test('default detection resolves claude/codex under HOME and finds OPENCLAW_HOME', () => {
  const home = mkTmp('sf-detect-')
  const ocSkills = path.join(home, 'oc', 'workspace', 'skills')
  fs.mkdirSync(ocSkills, { recursive: true })
  const { stdout } = runCli(['install'], {
    home,
    keepHome: true,
    extraEnv: { OPENCLAW_HOME: path.join(home, 'oc') }
  })

  assert(fs.existsSync(path.join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md')), 'claude default not written')
  assert(fs.existsSync(path.join(home, '.codex', 'skills', SKILL_NAME, 'SKILL.md')), 'codex default not written')
  assert(fs.existsSync(path.join(ocSkills, SKILL_NAME, 'SKILL.md')), 'OPENCLAW_HOME target not written')
  assert(stdout.includes('Installed to 3 target(s).'), 'expected 3 targets')
  rmrf(home)
})

test('install reports [skip] and a lower count when OpenClaw is not detected', () => {
  const { stdout } = runCli(['install'])
  assert(stdout.includes('[skip] openclaw — not detected'), 'openclaw skip not reported')
  assert(stdout.includes('Installed to 2 target(s).'), 'expected 2 targets (claude+codex)')
})

// --- exit codes ---

test('install exits non-zero when a target hard-fails', () => {
  const root = mkTmp('sf-fail-')
  // Point a custom target under a regular FILE so mkdir throws ENOTDIR.
  const blocker = path.join(root, 'blocker')
  fs.writeFileSync(blocker, 'x')
  const { code, stdout } = runCli(['install', `--claude=${path.join(blocker, 'nested')}`])
  assert(stdout.includes('[fail]'), 'expected a [fail] line')
  assert.strictEqual(code, 1, `expected exit 1 on failure, got ${code}`)
  rmrf(root)
})

// --- uninstall ---

test('uninstall removes the installed file set', () => {
  const root = mkTmp('sf-uninstall-')
  const claude = path.join(root, 'claude')
  runCli(['install', `--claude=${claude}`])
  const dir = path.join(claude, 'skills', SKILL_NAME)
  assert(fs.existsSync(path.join(dir, 'SKILL.md')), 'precondition: installed')

  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(!fs.existsSync(dir), `skill directory survived uninstall: ${fs.existsSync(dir) && fs.readdirSync(dir)}`)
  assert(stdout.includes('removed'), 'no removal message')
  rmrf(root)
})

test('uninstall removes our files but keeps a dir that holds a foreign file', () => {
  const root = mkTmp('sf-keep-')
  const claude = path.join(root, 'claude')
  const dir = path.join(claude, 'skills', SKILL_NAME)
  runCli(['install', `--claude=${claude}`])
  fs.writeFileSync(path.join(dir, 'other.txt'), 'keep me')

  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(!fs.existsSync(path.join(dir, 'SKILL.md')), 'SKILL.md not removed')
  assert(fs.existsSync(path.join(dir, 'other.txt')), 'unrelated file was deleted')
  assert(/directory kept/.test(stdout), 'message did not disclose the dir was kept')
  rmrf(root)
})

test('uninstall on a clean target reports skip, does not crash', () => {
  const root = mkTmp('sf-uninstall2-')
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(['uninstall', `--claude=${claude}`])
  assert(stdout.includes('not installed') || stdout.includes('[skip]'), 'no skip message')
  rmrf(root)
})

test('uninstall <slug> never touches another slug directory', () => {
  const root = mkTmp('sf-unione-')
  const claude = path.join(root, 'claude')
  runCli(['install', `--claude=${claude}`], FIXTURES)
  const { stdout } = runCli(['uninstall', 'alpha', `--claude=${claude}`], FIXTURES)
  assert(!fs.existsSync(path.join(claude, 'skills', 'alpha')), 'alpha not removed')
  assert(
    fs.existsSync(path.join(claude, 'skills', 'beta', 'SKILL.md')),
    `beta was removed too:\n${stdout}`
  )
  rmrf(root)
})
