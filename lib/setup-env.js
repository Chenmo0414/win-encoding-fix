'use strict'

// HOST-MACHINE configuration, not per-skill configuration.
//
// Everything here targets the machine — Windows User-level environment
// variables, ~/.bash_profile, ~/.bashrc, global git config. None of it is a
// skill's content, and it runs ONCE, only when the user explicitly asks
// (`setup-env`, or `install --setup-env`) — never once per installed skill.
//
// EXTENSION POINT: if a second skill ever needs machine configuration, add a
// second explicit command (`setup-xyz`) and wire it in lib/cli.js. Do NOT add a
// per-skill hook table, a `setup:` frontmatter key, or a lifecycle-script
// mechanism: that would turn a plain function into a plugin host with a sandbox,
// for a repo whose skills all ship in this same git history.

const fs = require('fs')
const os = require('os')
const path = require('path')

// FROZEN COMPATIBILITY CONSTANT. This exact string is already written into real
// users' ~/.bash_profile. Renaming it orphans the installed block, so the next
// run would append a duplicate set of exports instead of detecting its own work.
const BLOCK_MARKER = '# win-encoding-fix:'

// SINGLE SOURCE OF TRUTH for the git settings. The exported key list is DERIVED
// from this array rather than typed out again: a second hand-maintained copy let
// the "SKILL.md documents what the tool writes" test stay green while the two
// lists drifted apart.
const GIT_CONFIGS = [
  ['core.quotepath', 'false'],
  ['core.autocrlf', 'input'],
  ['i18n.commitEncoding', 'utf-8'],
  ['i18n.logOutputEncoding', 'utf-8'],
  ['core.pager', 'less -R']
]
const GIT_CONFIG_KEYS = GIT_CONFIGS.map(([key]) => key)

function setupEnv(opts = {}) {
  const {
    home = os.homedir(),
    platform = process.platform,
    env = process.env,
    log = console.log
  } = opts

  let failed = false

  log('\n--- Environment Setup ---')
  log('This will modify: ~/.bash_profile, ~/.bashrc, your global git config' +
    (platform === 'win32' ? ', and Windows User environment variables.\n' : '.\n'))

  const { execFileSync } = require('child_process')

  // 1) Windows User-level env vars — inherited by EVERY process (most robust).
  //    Required because non-login/non-interactive shells (what AI agents and
  //    scripts spawn) never source ~/.bash_profile, so vars set only there
  //    don't reach the Python/Node the agent actually runs.
  //
  //    NOTE: use execFileSync (no cmd.exe) and SINGLE-quoted PowerShell string
  //    literals. Passing double quotes through `execSync('powershell -Command
  //    "...\"x\"..."')` lets cmd.exe strip the inner quotes, leaving PowerShell
  //    bare words that fail to parse — so the vars were never actually set.
  const skipWinEnv = env.SKILL_FACTORY_SKIP_WINENV || env.WIN_ENCODING_FIX_SKIP_WINENV
  if (platform === 'win32' && !skipWinEnv) {
    const psSetEnv =
      "[Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'User'); " +
      "[Environment]::SetEnvironmentVariable('PYTHONIOENCODING', 'utf-8', 'User')"
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', psSetEnv], { stdio: 'pipe' })
      log('  [ok]   Windows User env — PYTHONUTF8=1, PYTHONIOENCODING=utf-8 (restart terminal to apply)')
    } catch (err) {
      log(`  [FAIL] Windows User env — could NOT set (${String(err.message).split('\n')[0]})`)
      log('         This is the most robust layer; the bash_profile fallback below only')
      log('         reaches interactive Git Bash, not the non-interactive shells agents spawn.')
      failed = true
    }
  } else if (platform !== 'win32') {
    log('  [skip] Windows User env — not on Windows')
  }

  // 2) bash rc files — for interactive Git Bash sessions.
  const bashProfile = path.join(home, '.bash_profile')
  const bashRc = path.join(home, '.bashrc')
  const envBlock = [
    BLOCK_MARKER + ' Encoding fixes for Windows GBK → UTF-8',
    'export PYTHONUTF8=1',
    'export PYTHONIOENCODING=utf-8',
    'export LANG=en_US.UTF-8',
    'export LESSCHARSET=utf-8'
  ].join('\n') + '\n'

  if (fs.existsSync(bashProfile)) {
    const content = fs.readFileSync(bashProfile, 'utf-8')
    // Detect by our block marker, not a single var name — otherwise a user who
    // set PYTHONUTF8 by other means blocks the other vars from ever being added.
    if (content.includes(BLOCK_MARKER)) {
      log('  [ok]   ~/.bash_profile — already configured')
    } else {
      fs.appendFileSync(bashProfile, (content.endsWith('\n') ? '' : '\n') + envBlock)
      log('  [ok]   ~/.bash_profile — appended encoding vars')
    }
  } else {
    fs.writeFileSync(bashProfile, envBlock, 'utf-8')
    log('  [ok]   ~/.bash_profile — created')
  }

  // Make non-login interactive shells (which source .bashrc, not .bash_profile)
  // pick up the same vars.
  const sourceLine = '[ -f ~/.bash_profile ] && . ~/.bash_profile'
  const rcContent = fs.existsSync(bashRc) ? fs.readFileSync(bashRc, 'utf-8') : ''
  if (rcContent.includes('.bash_profile')) {
    log('  [ok]   ~/.bashrc — already sources .bash_profile')
  } else {
    fs.appendFileSync(bashRc, (rcContent && !rcContent.endsWith('\n') ? '\n' : '') + sourceLine + '\n')
    log('  [ok]   ~/.bashrc — sources .bash_profile')
  }

  // 3) Git global config.
  //
  //    execFileSync, not execSync with an interpolated double-quoted value: on
  //    win32 execSync goes through cmd.exe, which is the exact quote-eating path
  //    this repo's own rule 5 forbids. A repo that teaches that rule must not
  //    ship a counter-example.
  let gitFailed = 0
  for (const [key, value] of GIT_CONFIGS) {
    try {
      execFileSync('git', ['config', '--global', key, value], { stdio: 'pipe' })
    } catch {
      gitFailed++
    }
  }
  if (gitFailed === 0) {
    log('  [ok]   git config — set encoding defaults')
  } else if (gitFailed < GIT_CONFIGS.length) {
    log(`  [warn] git config — ${gitFailed} of ${GIT_CONFIGS.length} settings failed`)
  } else {
    log('  [FAIL] git config — could not set any defaults (is git on PATH?)')
    failed = true
  }

  return { failed }
}

module.exports = { setupEnv, BLOCK_MARKER, GIT_CONFIGS, GIT_CONFIG_KEYS }
