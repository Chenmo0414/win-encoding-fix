#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')

const SKILL_NAME = 'windows-shell'
const SKILL_FILE = path.join(__dirname, '..', 'skills', SKILL_NAME, 'SKILL.md')

// --- Arg parsing ---

const args = process.argv.slice(2)
const flags = args.filter(a => a.startsWith('-'))
const command = flags.includes('--help') || flags.includes('-h')
  ? 'help'
  : args.find(a => !a.startsWith('-')) || 'install'

// Accept both `--name=value` and `--name value`. Returns:
//   a non-empty string  -> the value
//   ''                  -> flag present but value missing/empty (caller warns)
//   null               -> flag not present
function getFlag(name) {
  const eq = `--${name}=`
  const withEq = flags.find(f => f.startsWith(eq))
  if (withEq) return withEq.slice(eq.length) // may be '' for `--name=`

  const idx = args.indexOf(`--${name}`)
  if (idx !== -1) {
    const next = args[idx + 1]
    return next && !next.startsWith('-') ? next : ''
  }
  return null
}

// Resolve a custom-path flag, warning (and falling back to default) when the
// flag was given without a usable value instead of silently ignoring it.
function customPath(name) {
  const raw = getFlag(name)
  if (raw === null) return null
  if (raw === '') {
    console.log(`  [warn] --${name} given without a path — expected --${name}=<path>; using default.`)
    return null
  }
  return raw
}

const customClaude = customPath('claude')
const customCodex = customPath('codex')
const customOpenclaw = customPath('openclaw')
const hasSetupEnv = flags.includes('--setup-env')

// --- Target detection ---

// Build the ordered list of install targets. OpenClaw may resolve to MORE THAN
// ONE root (e.g. installs on multiple drives), so targets is a flat list rather
// than a name->path map — otherwise multi-drive installs would silently only
// ever touch the first root found.
function defaultTargets() {
  const targets = [
    {
      name: 'claude',
      path: path.join(customClaude || path.join(os.homedir(), '.claude'), 'skills', SKILL_NAME)
    },
    {
      name: 'codex',
      path: path.join(customCodex || path.join(os.homedir(), '.codex'), 'skills', SKILL_NAME)
    }
  ]

  if (customOpenclaw) {
    targets.push({ name: 'openclaw', path: path.join(customOpenclaw, 'workspace', 'skills', SKILL_NAME) })
  } else {
    const roots = detectOpenclawRoots()
    if (roots.length === 0) {
      targets.push({ name: 'openclaw', path: null })
    } else {
      for (const root of roots) targets.push({ name: 'openclaw', path: root })
    }
  }

  return targets
}

// Return EVERY existing OpenClaw skills root (deduped by real path), not just
// the first — so install/uninstall reach all of them.
function detectOpenclawRoots() {
  const candidates = [
    process.env.OPENCLAW_HOME && path.join(process.env.OPENCLAW_HOME, 'workspace', 'skills', SKILL_NAME),
    path.join(os.homedir(), '.openclaw', 'workspace', 'skills', SKILL_NAME)
  ].filter(Boolean)

  // The drive scan reaches real installs regardless of HOME, so tests disable it
  // to stay hermetic (WIN_ENCODING_FIX_NO_DRIVE_SCAN=1).
  if (!process.env.WIN_ENCODING_FIX_NO_DRIVE_SCAN) {
    for (const drive of ['C', 'D', 'E', 'F']) {
      candidates.push(path.join(`${drive}:`, '.openclaw', 'workspace', 'skills', SKILL_NAME))
    }
  }

  const found = []
  const seen = new Set()
  for (const p of candidates) {
    const skillsDir = path.dirname(p)
    let exists = false
    try { exists = fs.existsSync(skillsDir) } catch { exists = false }
    if (!exists) continue
    // Dedupe roots that resolve to the same physical location (junctions, etc.).
    let key = p
    try { key = fs.realpathSync(skillsDir) } catch {}
    if (seen.has(key)) continue
    seen.add(key)
    found.push(p)
  }
  return found
}

// --- Actions ---

function install(target, targetPath) {
  if (!targetPath) {
    console.log(`  [skip] ${target} — not detected`)
    return 'skip'
  }

  try {
    fs.mkdirSync(targetPath, { recursive: true })
    fs.copyFileSync(SKILL_FILE, path.join(targetPath, 'SKILL.md'))
    console.log(`  [ok]   ${target} — ${targetPath}`)
    return 'ok'
  } catch (err) {
    console.log(`  [fail] ${target} — ${err.message}`)
    return 'fail'
  }
}

function uninstall(target, targetPath) {
  if (!targetPath) return
  const file = path.join(targetPath, 'SKILL.md')
  if (!fs.existsSync(file)) {
    console.log(`  [skip] ${target} — not installed`)
    return
  }

  fs.unlinkSync(file)
  // rmdirSync only removes an empty dir; keep the message honest about whether
  // the directory is actually gone (it may still hold unrelated files).
  let dirGone = false
  try {
    fs.rmdirSync(targetPath)
    dirGone = true
  } catch {}
  if (dirGone) {
    console.log(`  [ok]   ${target} — removed`)
  } else {
    console.log(`  [ok]   ${target} — SKILL.md removed (directory kept — still contains other files)`)
  }
}

function setupEnv() {
  console.log('\n--- Environment Setup ---')
  console.log('This will modify: ~/.bash_profile, ~/.bashrc, your global git config' +
    (process.platform === 'win32' ? ', and Windows User environment variables.\n' : '.\n'))

  const { execSync, execFileSync } = require('child_process')

  // 1) Windows User-level env vars — inherited by EVERY process (most robust).
  //    Required because non-login/non-interactive shells (what AI agents and
  //    scripts spawn) never source ~/.bash_profile, so vars set only there
  //    don't reach the Python/Node the agent actually runs.
  //
  //    NOTE: use execFileSync (no cmd.exe) and SINGLE-quoted PowerShell string
  //    literals. Passing double quotes through `execSync('powershell -Command
  //    "...\"x\"..."')` lets cmd.exe strip the inner quotes, leaving PowerShell
  //    bare words that fail to parse — so the vars were never actually set.
  if (process.platform === 'win32' && !process.env.WIN_ENCODING_FIX_SKIP_WINENV) {
    const psSetEnv =
      "[Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'User'); " +
      "[Environment]::SetEnvironmentVariable('PYTHONIOENCODING', 'utf-8', 'User')"
    try {
      execFileSync('powershell', ['-NoProfile', '-Command', psSetEnv], { stdio: 'pipe' })
      console.log('  [ok]   Windows User env — PYTHONUTF8=1, PYTHONIOENCODING=utf-8 (restart terminal to apply)')
    } catch (err) {
      console.log(`  [FAIL] Windows User env — could NOT set (${String(err.message).split('\n')[0]})`)
      console.log('         This is the most robust layer; the bash_profile fallback below only')
      console.log('         reaches interactive Git Bash, not the non-interactive shells agents spawn.')
      process.exitCode = 1
    }
  } else if (process.platform !== 'win32') {
    console.log('  [skip] Windows User env — not on Windows')
  }

  // 2) bash rc files — for interactive Git Bash sessions.
  const bashProfile = path.join(os.homedir(), '.bash_profile')
  const bashRc = path.join(os.homedir(), '.bashrc')
  const BLOCK_MARKER = '# win-encoding-fix:'
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
      console.log('  [ok]   ~/.bash_profile — already configured')
    } else {
      fs.appendFileSync(bashProfile, (content.endsWith('\n') ? '' : '\n') + envBlock)
      console.log('  [ok]   ~/.bash_profile — appended encoding vars')
    }
  } else {
    fs.writeFileSync(bashProfile, envBlock, 'utf-8')
    console.log('  [ok]   ~/.bash_profile — created')
  }

  // Make non-login interactive shells (which source .bashrc, not .bash_profile)
  // pick up the same vars.
  const sourceLine = '[ -f ~/.bash_profile ] && . ~/.bash_profile'
  const rcContent = fs.existsSync(bashRc) ? fs.readFileSync(bashRc, 'utf-8') : ''
  if (rcContent.includes('.bash_profile')) {
    console.log('  [ok]   ~/.bashrc — already sources .bash_profile')
  } else {
    fs.appendFileSync(bashRc, (rcContent && !rcContent.endsWith('\n') ? '\n' : '') + sourceLine + '\n')
    console.log('  [ok]   ~/.bashrc — sources .bash_profile')
  }

  // 3) Git global config.
  const gitConfigs = [
    ['core.quotepath', 'false'],
    ['core.autocrlf', 'input'],
    ['i18n.commitEncoding', 'utf-8'],
    ['i18n.logOutputEncoding', 'utf-8'],
    ['core.pager', 'less -R']
  ]

  let gitFailed = 0
  for (const [key, value] of gitConfigs) {
    try {
      execSync(`git config --global ${key} "${value}"`, { stdio: 'pipe' })
    } catch {
      gitFailed++
    }
  }
  if (gitFailed === 0) {
    console.log('  [ok]   git config — set encoding defaults')
  } else if (gitFailed < gitConfigs.length) {
    console.log(`  [warn] git config — ${gitFailed} of ${gitConfigs.length} settings failed`)
  } else {
    console.log('  [FAIL] git config — could not set any defaults (is git on PATH?)')
    process.exitCode = 1
  }
}

function showHelp() {
  console.log('Usage: win-encoding-fix [command] [options]')
  console.log('')
  console.log('Commands:')
  console.log('  install      Install SKILL.md to Claude/Codex/OpenClaw (default)')
  console.log('  uninstall    Remove installed skill files')
  console.log('  setup-env    Configure ~/.bash_profile and git for UTF-8')
  console.log('')
  console.log('Options:')
  console.log('  --setup-env                Also run env setup during install')
  console.log('  --claude=<path>            Custom Claude Code config directory')
  console.log('  --codex=<path>             Custom Codex config directory')
  console.log('  --openclaw=<path>          Custom OpenClaw root directory')
  console.log('')
  console.log('Examples:')
  console.log('  npx win-encoding-fix install --setup-env')
  console.log('  npx win-encoding-fix install --claude=D:\\my-claude')
  console.log('  npx win-encoding-fix install --openclaw=E:\\.openclaw')
  console.log('  npx win-encoding-fix uninstall')
}

// --- Main ---

console.log(`\nwin-encoding-fix v${require('../package.json').version}\n`)

const targets = defaultTargets()

if (command === 'install') {
  console.log('Installing skill files...\n')
  let installed = 0
  let failed = 0
  for (const { name, path: targetPath } of targets) {
    const result = install(name, targetPath)
    if (result === 'ok') installed++
    else if (result === 'fail') failed++
  }
  console.log(`\nInstalled to ${installed} target(s).`)
  if (failed > 0) process.exitCode = 1

  if (hasSetupEnv) {
    setupEnv()
  } else {
    console.log('\nTip: run with --setup-env to also configure bash_profile and git config.')
  }
} else if (command === 'uninstall') {
  console.log('Uninstalling...\n')
  for (const { name, path: targetPath } of targets) {
    uninstall(name, targetPath)
  }
} else if (command === 'setup-env') {
  setupEnv()
} else if (command === 'help') {
  showHelp()
} else {
  console.log(`Unknown command: ${command}\n`)
  showHelp()
  process.exitCode = 1
}

console.log('')
