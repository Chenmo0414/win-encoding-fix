'use strict'

// Argument parsing, command dispatch, and every byte of stdout.
//
// Requiring this module has no side effects: argv is read and printing happens
// only inside run(). That is what makes the other lib/ modules unit-testable —
// and it is why `--help` no longer scans C:/D:/E:/F: for OpenClaw installs, and
// why `--version` no longer installs anything.

const PKG = require('../package.json')
const { resolveTargets } = require('./targets')
const { filesOf, installSkill, uninstallSkill } = require('./install')
const { listSkills, readMeta, resolveSlugs } = require('./skills')
const { setupEnv } = require('./setup-env')

const PRODUCT = 'skill-factory（Skill 工厂）'

// --- Arg parsing ---

const VALUE_FLAGS = ['claude', 'codex', 'openclaw']
const BOOL_FLAGS = ['setup-env', 'help', 'h', 'version', 'v']
const COMMANDS = ['install', 'uninstall', 'setup-env', 'list', 'help']

// Pure: returns what was asked for, including any warnings to print. Never
// prints, never touches the filesystem.
//
// The scan is sequential rather than filter-based so that the VALUE of a
// space-form flag is CONSUMED. Otherwise `skill-factory --claude D:\x` reads
// `D:\x` as the command and dies with "Unknown command: D:\x".
function parseArgs(argv) {
  const values = { claude: null, codex: null, openclaw: null }
  const bools = {}
  const positionals = []
  const warnings = []
  const unknownFlags = []

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('-')) {
      positionals.push(token)
      continue
    }

    const body = token.replace(/^--?/, '')
    const eq = body.indexOf('=')
    const name = eq === -1 ? body : body.slice(0, eq)

    if (VALUE_FLAGS.includes(name)) {
      let value
      if (eq !== -1) {
        value = body.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith('-')) {
          value = next
          i++ // consume it, so it never becomes a positional
        } else {
          value = ''
        }
      }
      // Warn (and fall back to the default) when the flag was given without a
      // usable value, instead of silently ignoring it.
      if (value === '') {
        warnings.push(`  [warn] --${name} given without a path — expected --${name}=<path>; using default.`)
      } else {
        values[name] = value
      }
      continue
    }

    if (BOOL_FLAGS.includes(name) && eq === -1) {
      bools[name] = true
      continue
    }

    unknownFlags.push(token)
  }

  return {
    // First positional is ALWAYS the command; the rest are skill slugs. That
    // removes any ambiguity about whether a bare word is a command or a slug.
    command: positionals[0] || 'install',
    slugs: positionals.slice(1),
    claude: values.claude,
    codex: values.codex,
    openclaw: values.openclaw,
    setupEnv: !!bools['setup-env'],
    help: !!(bools.help || bools.h),
    version: !!(bools.version || bools.v),
    warnings,
    unknownFlags
  }
}

// --- Reporting ---

// `  [ok]   claude — D:\...`, `  [skip] openclaw — not detected`. The exact
// spacing and the em dash are a tested contract; the em dash doubles as the
// suite's only UTF-8 round-trip canary through spawn → stdout → assertion.
function statusLine(status, name, message) {
  return `  ${`[${status}]`.padEnd(6)} ${name} — ${message}`
}

function showHelp(log) {
  log('Usage: skill-factory [command] [skill...] [options]')
  log('')
  log('Commands:')
  log('  install [skill...]    Install skills to Claude/Codex/OpenClaw (default)')
  log('  uninstall [skill...]  Remove installed skill files')
  log('  list                  List the skills in this factory')
  log('  setup-env             Configure ~/.bash_profile and git for UTF-8')
  log('')
  log('Naming no skill means every skill in the factory.')
  log('')
  log('Options:')
  log('  --setup-env                Also run env setup during install')
  log('  --claude=<path>            Custom Claude Code config directory')
  log('  --codex=<path>             Custom Codex config directory')
  log('  --openclaw=<path>          Custom OpenClaw root directory')
  log('  --version, -v              Print the factory version and exit')
  log('  --help, -h                 Show this help')
  log('')
  log('Examples:')
  log('  skill-factory install --setup-env')
  log('  skill-factory install windows-shell')
  log('  skill-factory install --claude=D:\\my-claude')
  log('  skill-factory install --openclaw=E:\\.openclaw')
  log('  skill-factory uninstall')
}

function reportUnknownSlugs(unknown, all, log) {
  log(`Unknown skill: ${unknown.join(', ')}`)
  log(`Available: ${all.map(s => s.slug).join(', ') || '(none)'}`)
}

// --- Commands ---

function cmdInstall(opts, log) {
  const all = listSkills()
  const { skills, unknown } = resolveSlugs(opts.slugs, all)
  if (unknown.length) {
    reportUnknownSlugs(unknown, all, log)
    return 1
  }
  if (skills.length === 0) {
    log('No skills found in this factory.')
    return 1
  }

  const targets = resolveTargets({
    claude: opts.claude,
    codex: opts.codex,
    openclaw: opts.openclaw
  })

  log('Installing skill files...\n')
  // Counted by DISTINCT TARGET, not by skill×target pairs: "Installed to 3
  // target(s)." stays true and readable however many skills were copied, and
  // the per-skill destination is already visible in each [ok] line.
  const written = new Set()
  let failed = 0

  for (const skill of skills) {
    const files = filesOf(skill.dir)
    for (const { name, skillsRoot } of targets) {
      const result = installSkill({ slug: skill.slug, sourceDir: skill.dir, files, skillsRoot })
      log(statusLine(result.status, name, result.message))
      if (result.status === 'ok') written.add(`${name}\u0000${skillsRoot}`)
      else if (result.status === 'fail') failed++
    }
  }

  log(`\nInstalled to ${written.size} target(s).`)
  let exitCode = failed > 0 ? 1 : 0

  if (opts.setupEnv) {
    if (setupEnv({ log }).failed) exitCode = 1
  } else {
    log('\nTip: run with --setup-env to also configure bash_profile and git config.')
  }
  return exitCode
}

function cmdUninstall(opts, log) {
  const all = listSkills()
  const { skills, unknown } = resolveSlugs(opts.slugs, all)
  if (unknown.length) {
    reportUnknownSlugs(unknown, all, log)
    return 1
  }

  const targets = resolveTargets({
    claude: opts.claude,
    codex: opts.codex,
    openclaw: opts.openclaw
  })

  log('Uninstalling...\n')
  for (const skill of skills) {
    const files = filesOf(skill.dir)
    for (const { name, skillsRoot } of targets) {
      if (!skillsRoot) continue
      const result = uninstallSkill({ slug: skill.slug, files, skillsRoot })
      log(statusLine(result.status, name, result.message))
    }
  }
  return 0
}

function cmdList(log) {
  const all = listSkills()
  if (all.length === 0) {
    log('No skills found in this factory.')
    return 1
  }

  log('Skills in this factory:\n')
  const width = all.reduce((w, s) => Math.max(w, s.slug.length), 0)
  for (const skill of all) {
    const meta = readMeta(skill)
    const description = (meta.description || '').slice(0, 60)
    log(`  ${skill.slug.padEnd(width)}  ${(meta.version || '?').padEnd(8)} ${description}`)
  }
  return 0
}

// --- Main ---

function run(argv, log = console.log) {
  const opts = parseArgs(argv)

  // --version prints ONE constant line and exits: it is the only output a
  // script would ever parse, and it must not scan drives or write anything.
  if (opts.version) {
    log(`${PKG.name} ${PKG.version}`)
    return 0
  }

  for (const warning of opts.warnings) log(warning)

  log(`\n${PRODUCT} v${PKG.version}\n`)

  if (opts.unknownFlags.length) {
    log(`Unknown option: ${opts.unknownFlags[0]}\n`)
    showHelp(log)
    log('')
    return 1
  }

  const command = opts.help ? 'help' : opts.command
  let exitCode = 0

  if (!COMMANDS.includes(command)) {
    log(`Unknown command: ${command}\n`)
    showHelp(log)
    exitCode = 1
  } else if (command === 'install') {
    exitCode = cmdInstall(opts, log)
  } else if (command === 'uninstall') {
    exitCode = cmdUninstall(opts, log)
  } else if (command === 'setup-env') {
    exitCode = setupEnv({ log }).failed ? 1 : 0
  } else if (command === 'list') {
    exitCode = cmdList(log)
  } else {
    showHelp(log)
  }

  log('')
  return exitCode
}

module.exports = { run, parseArgs, showHelp, statusLine, PRODUCT }
