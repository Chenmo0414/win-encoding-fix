#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const os = require('os')

const SKILL_NAME = 'windows-shell'
const SKILL_FILE = path.join(__dirname, '..', 'SKILL.md')

const targets = {
  claude: path.join(os.homedir(), '.claude', 'skills', SKILL_NAME),
  codex: path.join(os.homedir(), '.codex', 'skills', SKILL_NAME),
  openclaw: null // detected dynamically
}

function detectOpenclaw() {
  const candidates = [
    process.env.OPENCLAW_HOME && path.join(process.env.OPENCLAW_HOME, 'workspace', 'skills', SKILL_NAME),
    path.join(os.homedir(), '.openclaw', 'workspace', 'skills', SKILL_NAME)
  ].filter(Boolean)

  // Also check drive roots (D:\.openclaw is common)
  for (const drive of ['C', 'D', 'E']) {
    candidates.push(path.join(`${drive}:`, '.openclaw', 'workspace', 'skills', SKILL_NAME))
  }

  for (const p of candidates) {
    const skillsDir = path.dirname(p)
    if (fs.existsSync(skillsDir)) return p
  }
  return null
}

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

  // .bash_profile
  const bashProfile = path.join(os.homedir(), '.bash_profile')
  const envBlock = [
    '# windows-shell-skill: Encoding fixes for Windows GBK → UTF-8',
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

  // Git config
  const { execSync } = require('child_process')
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

// --- Main ---

const args = process.argv.slice(2)
const command = args[0] || 'install'

console.log(`\nwindows-shell-skill v${require('../package.json').version}\n`)

targets.openclaw = detectOpenclaw()

if (command === 'install') {
  console.log('Installing skill files...\n')
  let count = 0
  for (const [name, targetPath] of Object.entries(targets)) {
    if (install(name, targetPath)) count++
  }
  console.log(`\nInstalled to ${count} target(s).`)

  if (args.includes('--setup-env')) {
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
} else {
  console.log('Usage: windows-shell-skill [install|uninstall|setup-env] [--setup-env]')
  console.log('')
  console.log('Commands:')
  console.log('  install      Install SKILL.md to Claude/Codex/OpenClaw (default)')
  console.log('  uninstall    Remove installed skill files')
  console.log('  setup-env    Configure ~/.bash_profile and git for UTF-8')
  console.log('')
  console.log('Options:')
  console.log('  --setup-env  Also run env setup during install')
}

console.log('')
