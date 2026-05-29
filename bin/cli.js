#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')

const SKILL_NAME = 'windows-shell'
const SKILL_FILE = path.join(__dirname, '..', 'SKILL.md')

// --- Arg parsing ---

const args = process.argv.slice(2)
const flags = args.filter(a => a.startsWith('-'))
const command = flags.includes('--help') || flags.includes('-h')
  ? 'help'
  : args.find(a => !a.startsWith('-')) || 'install'

function getFlag(name) {
  const prefix = `--${name}=`
  const flag = flags.find(f => f.startsWith(prefix))
  return flag ? flag.slice(prefix.length) : null
}

const customClaude = getFlag('claude')
const customCodex = getFlag('codex')
const customOpenclaw = getFlag('openclaw')
const hasSetupEnv = flags.includes('--setup-env')

// --- Target detection ---

function defaultTargets() {
  return {
    claude: customClaude
      ? path.join(customClaude, 'skills', SKILL_NAME)
      : path.join(os.homedir(), '.claude', 'skills', SKILL_NAME),
    codex: customCodex
      ? path.join(customCodex, 'skills', SKILL_NAME)
      : path.join(os.homedir(), '.codex', 'skills', SKILL_NAME),
    openclaw: customOpenclaw
      ? path.join(customOpenclaw, 'workspace', 'skills', SKILL_NAME)
      : detectOpenclaw()
  }
}

function detectOpenclaw() {
  const candidates = [
    process.env.OPENCLAW_HOME && path.join(process.env.OPENCLAW_HOME, 'workspace', 'skills', SKILL_NAME),
    path.join(os.homedir(), '.openclaw', 'workspace', 'skills', SKILL_NAME)
  ].filter(Boolean)

  for (const drive of ['C', 'D', 'E', 'F']) {
    candidates.push(path.join(`${drive}:`, '.openclaw', 'workspace', 'skills', SKILL_NAME))
  }

  for (const p of candidates) {
    const skillsDir = path.dirname(p)
    if (fs.existsSync(skillsDir)) return p
  }
  return null
}

// --- Actions ---

function install(target, targetPath) {
  if (!targetPath) {
    console.log(`  [skip] ${target} — not detected`)
    return false
  }

  try {
    fs.mkdirSync(targetPath, { recursive: true })
    fs.copyFileSync(SKILL_FILE, path.join(targetPath, 'SKILL.md'))
    console.log(`  [ok]   ${target} — ${targetPath}`)
    return true
  } catch (err) {
    console.log(`  [fail] ${target} — ${err.message}`)
    return false
  }
}

function uninstall(target, targetPath) {
  if (!targetPath) return
  const file = path.join(targetPath, 'SKILL.md')
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    try { fs.rmdirSync(targetPath) } catch {}
    console.log(`  [ok]   ${target} — removed`)
  } else {
    console.log(`  [skip] ${target} — not installed`)
  }
}

function setupEnv() {
  console.log('\n--- Environment Setup ---\n')

  const { execSync } = require('child_process')

  // 1) Windows User-level env vars — inherited by EVERY process (most robust).
  //    Required because non-login/non-interactive shells (what AI agents and
  //    scripts spawn) never source ~/.bash_profile, so vars set only there
  //    don't reach the Python/Node the agent actually runs.
  if (process.platform === 'win32' && !process.env.WIN_ENCODING_FIX_SKIP_WINENV) {
    const psSetEnv =
      '[Environment]::SetEnvironmentVariable("PYTHONUTF8", "1", "User"); ' +
      '[Environment]::SetEnvironmentVariable("PYTHONIOENCODING", "utf-8", "User")'
    try {
      execSync(`powershell -Command "${psSetEnv}"`, { stdio: 'pipe' })
      console.log('  [ok]   Windows User env — PYTHONUTF8=1, PYTHONIOENCODING=utf-8 (restart terminal to apply)')
    } catch (err) {
      console.log(`  [warn] Windows User env — could not set (${err.message.split('\n')[0]})`)
    }
  }

  // 2) bash rc files — for interactive Git Bash sessions.
  const bashProfile = path.join(os.homedir(), '.bash_profile')
  const bashRc = path.join(os.homedir(), '.bashrc')
  const envBlock = [
    '# win-encoding-fix: Encoding fixes for Windows GBK → UTF-8',
    'export PYTHONUTF8=1',
    'export PYTHONIOENCODING=utf-8',
    'export LANG=en_US.UTF-8',
    'export LESSCHARSET=utf-8'
  ].join('\n') + '\n'

  if (fs.existsSync(bashProfile)) {
    const content = fs.readFileSync(bashProfile, 'utf-8')
    if (content.includes('PYTHONUTF8=1')) {
      console.log('  [ok]   ~/.bash_profile — already configured')
    } else {
      fs.appendFileSync(bashProfile, '\n' + envBlock)
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

  for (const [key, value] of gitConfigs) {
    try {
      execSync(`git config --global ${key} "${value}"`, { stdio: 'pipe' })
    } catch {}
  }
  console.log('  [ok]   git config — set encoding defaults')
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
  let count = 0
  for (const [name, targetPath] of Object.entries(targets)) {
    if (install(name, targetPath)) count++
  }
  console.log(`\nInstalled to ${count} target(s).`)

  if (hasSetupEnv) {
    setupEnv()
  } else {
    console.log('\nTip: run with --setup-env to also configure bash_profile and git config.')
  }
} else if (command === 'uninstall') {
  console.log('Uninstalling...\n')
  for (const [name, targetPath] of Object.entries(targets)) {
    uninstall(name, targetPath)
  }
} else if (command === 'setup-env') {
  setupEnv()
} else if (command === 'help') {
  showHelp()
} else {
  console.log(`Unknown command: ${command}\n`)
  showHelp()
}

console.log('')
