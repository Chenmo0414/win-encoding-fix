'use strict'

// Argument parsing, command dispatch, and every byte of stdout.
//
// Requiring this module has no side effects: argv is read and printing happens
// only inside run(). That is what makes the other lib/ modules unit-testable —
// and it is why `--help` no longer scans C:/D:/E:/F: for OpenClaw installs.

const path = require('path')

const { resolveTargets } = require('./targets')
const { installSkill, uninstallSkill } = require('./install')
const { setupEnv } = require('./setup-env')

const SKILL_NAME = 'windows-shell'
const SKILL_DIR = path.join(__dirname, '..', 'skills', SKILL_NAME)
const SKILL_FILES = ['SKILL.md']

// --- Arg parsing ---

// Pure: returns what was asked for, including any warnings to print. Never
// prints, never touches the filesystem.
function parseArgs(argv) {
  const args = argv
  const flags = args.filter(a => a.startsWith('-'))
  const command = flags.includes('--help') || flags.includes('-h')
    ? 'help'
    : args.find(a => !a.startsWith('-')) || 'install'

  const warnings = []

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
      warnings.push(`  [warn] --${name} given without a path — expected --${name}=<path>; using default.`)
      return null
    }
    return raw
  }

  return {
    command,
    claude: customPath('claude'),
    codex: customPath('codex'),
    openclaw: customPath('openclaw'),
    setupEnv: flags.includes('--setup-env'),
    warnings
  }
}

// --- Reporting ---

// `  [ok]   claude — D:\...`, `  [skip] openclaw — not detected`. The exact
// spacing and the em dash are a tested contract; the em dash doubles as the
// suite's only UTF-8 round-trip canary through spawn → stdout → assertion.
function statusLine(status, name, message) {
  return `  ${`[${status}]`.padEnd(6)} ${name} — ${message}`
}

// --- Help ---

function showHelp(log) {
  log('Usage: win-encoding-fix [command] [options]')
  log('')
  log('Commands:')
  log('  install      Install SKILL.md to Claude/Codex/OpenClaw (default)')
  log('  uninstall    Remove installed skill files')
  log('  setup-env    Configure ~/.bash_profile and git for UTF-8')
  log('')
  log('Options:')
  log('  --setup-env                Also run env setup during install')
  log('  --claude=<path>            Custom Claude Code config directory')
  log('  --codex=<path>             Custom Codex config directory')
  log('  --openclaw=<path>          Custom OpenClaw root directory')
  log('')
  log('Examples:')
  log('  npx win-encoding-fix install --setup-env')
  log('  npx win-encoding-fix install --claude=D:\\my-claude')
  log('  npx win-encoding-fix install --openclaw=E:\\.openclaw')
  log('  npx win-encoding-fix uninstall')
}

// --- Main ---

function run(argv, log = console.log) {
  const opts = parseArgs(argv)
  let exitCode = 0

  for (const warning of opts.warnings) log(warning)

  log(`\nwin-encoding-fix v${require('../package.json').version}\n`)

  const targets = resolveTargets({
    claude: opts.claude,
    codex: opts.codex,
    openclaw: opts.openclaw
  })

  if (opts.command === 'install') {
    log('Installing skill files...\n')
    let installed = 0
    let failed = 0
    for (const { name, skillsRoot } of targets) {
      const result = installSkill({
        slug: SKILL_NAME,
        sourceDir: SKILL_DIR,
        files: SKILL_FILES,
        skillsRoot
      })
      log(statusLine(result.status, name, result.message))
      if (result.status === 'ok') installed++
      else if (result.status === 'fail') failed++
    }
    log(`\nInstalled to ${installed} target(s).`)
    if (failed > 0) exitCode = 1

    if (opts.setupEnv) {
      if (setupEnv({ log }).failed) exitCode = 1
    } else {
      log('\nTip: run with --setup-env to also configure bash_profile and git config.')
    }
  } else if (opts.command === 'uninstall') {
    log('Uninstalling...\n')
    for (const { name, skillsRoot } of targets) {
      if (!skillsRoot) continue
      const result = uninstallSkill({ slug: SKILL_NAME, files: SKILL_FILES, skillsRoot })
      log(statusLine(result.status, name, result.message))
    }
  } else if (opts.command === 'setup-env') {
    if (setupEnv({ log }).failed) exitCode = 1
  } else if (opts.command === 'help') {
    showHelp(log)
  } else {
    log(`Unknown command: ${opts.command}\n`)
    showHelp(log)
    exitCode = 1
  }

  log('')
  return exitCode
}

module.exports = { run, parseArgs, showHelp }
