'use strict'

// Host-machine setup. Every case spawns the CLI against an isolated HOME with
// GIT_CONFIG_GLOBAL redirected and the Windows-User-env branch skipped — see the
// harness for why the skip is not optional.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { test, runCli, mkTmp, rmrf } = require('./harness')
const { GIT_CONFIGS } = require('../lib/setup-env')

console.log('--- setup-env ---')

test('setup-env writes bash_profile, makes .bashrc source it, sets git config', () => {
  const home = mkTmp('sf-home-')
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
  const home = mkTmp('sf-append-')
  fs.writeFileSync(path.join(home, '.bash_profile'), '# my existing config\nalias ll="ls -la"\n')
  const { stdout } = runCli(['setup-env'], { home, keepHome: true })
  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  assert(profile.includes('alias ll='), 'existing content lost')
  assert(profile.includes('PYTHONUTF8=1'), 'encoding vars not appended')
  assert(stdout.includes('appended encoding vars'), 'append not reported')
  rmrf(home)
})

test('setup-env is idempotent (no duplicate exports on re-run)', () => {
  const home = mkTmp('sf-home2-')
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

// The block marker is a FROZEN constant: it is already in real users'
// ~/.bash_profile. Detecting by a single var name instead would let a user who
// set PYTHONUTF8 by other means block LANG/LESSCHARSET from ever being added.
test('setup-env block-marker detection triggers even if user pre-set PYTHONUTF8 elsewhere', () => {
  const home = mkTmp('sf-marker-')
  fs.writeFileSync(path.join(home, '.bash_profile'), 'export PYTHONUTF8=1\n')
  runCli(['setup-env'], { home, keepHome: true })
  const profile = fs.readFileSync(path.join(home, '.bash_profile'), 'utf-8')
  assert(profile.includes('# win-encoding-fix:'), 'block marker not added')
  assert(profile.includes('LANG=en_US.UTF-8'), 'LANG not added despite pre-set PYTHONUTF8')
  rmrf(home)
})

test('setup-env survives git config failure without throwing', () => {
  const home = mkTmp('sf-gitfail-')
  // Point git global config at a directory so every write fails.
  const badGit = path.join(home, 'gitdir')
  fs.mkdirSync(badGit, { recursive: true })
  const { stdout } = runCli(['setup-env'], {
    home,
    keepHome: true,
    extraEnv: { GIT_CONFIG_GLOBAL: badGit }
  })
  assert(fs.existsSync(path.join(home, '.bash_profile')), 'bash_profile not written')
  assert(/git config/.test(stdout), 'no git config status line')
  rmrf(home)
})

test('install --setup-env runs both phases', () => {
  const root = mkTmp('sf-both-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const claude = path.join(root, 'claude')
  const { stdout } = runCli(
    ['install', '--setup-env', `--claude=${claude}`],
    { home, keepHome: true, extraEnv: { GIT_CONFIG_GLOBAL: path.join(home, '.gc') } }
  )
  assert(fs.existsSync(path.join(claude, 'skills', 'windows-shell', 'SKILL.md')), 'skill not installed')
  assert(stdout.includes('Environment Setup'), 'setup-env phase did not run')
  rmrf(root)
})

// EVERY key setup-env claims to write must actually land, with the right value.
// Asserting only on quotepath (as this suite once did) let a mutation that
// dropped core.autocrlf and both i18n.* keys pass with 81/81 green — and the
// i18n ones are precisely what stops `git log` from showing mojibake.
//
// git itself is the reader, so this tests what git would actually resolve rather
// than a hand-rolled ini parse. Values come from lib/setup-env.js's own list, so
// adding a sixth setting is covered automatically.
test('every git setting setup-env writes lands with the right value', () => {
  const home = mkTmp('sf-gitkeys-')
  const gitConfig = path.join(home, '.gitconfig-test')
  runCli(['setup-env'], { home, keepHome: true, extraEnv: { GIT_CONFIG_GLOBAL: gitConfig } })

  assert(GIT_CONFIGS.length >= 5, `expected at least 5 git settings, module lists ${GIT_CONFIGS.length}`)
  for (const [key, expected] of GIT_CONFIGS) {
    const actual = execFileSync('git', ['config', '--file', gitConfig, '--get', key], {
      encoding: 'utf-8'
    }).trim()
    // "less -R" has a space, so core.pager is also the case that proves the
    // execFileSync argv form did not lose the quoting cmd.exe would have eaten.
    assert.strictEqual(actual, expected, `${key} = "${actual}", expected "${expected}"`)
  }
  rmrf(home)
})

// If this gate ever stopped working, setupEnv would really call
// SetEnvironmentVariable(..., 'User'), which broadcasts WM_SETTINGCHANGE and can
// hang the spawning process — during `npm test`.
test('legacy WIN_ENCODING_FIX_SKIP_WINENV still skips the Windows env branch', () => {
  const home = mkTmp('sf-legacy-')
  const { stdout } = runCli(['setup-env'], {
    home,
    keepHome: true,
    extraEnv: {
      SKILL_FACTORY_SKIP_WINENV: '',
      WIN_ENCODING_FIX_SKIP_WINENV: '1',
      GIT_CONFIG_GLOBAL: path.join(home, '.gc')
    }
  })
  // Assert on the branch's OUTCOME markers, not on the shared "Windows User env"
  // label: on a non-win32 host lib/setup-env.js prints
  // "  [skip] Windows User env — not on Windows", which contains that label. A
  // bare !includes('Windows User env —') would therefore fail on every ubuntu
  // CI leg while the code is perfectly correct.
  assert(!stdout.includes('[ok]   Windows User env'), `the Windows env branch ran:\n${stdout}`)
  assert(!stdout.includes('[FAIL] Windows User env'), `the Windows env branch ran and failed:\n${stdout}`)
  rmrf(home)
})

test('setup-env installs no skills', () => {
  const home = mkTmp('sf-hostonly-')
  runCli(['setup-env'], { home, keepHome: true, extraEnv: { GIT_CONFIG_GLOBAL: path.join(home, '.gc') } })
  assert(!fs.existsSync(path.join(home, '.claude')), 'setup-env created ~/.claude')
  assert(!fs.existsSync(path.join(home, '.codex')), 'setup-env created ~/.codex')
  rmrf(home)
})
