'use strict'

// CLI surface: help, version, dispatch, exit codes, and the banner.
// Install/uninstall behaviour lives in install.test.js; the registry lives in
// skills.test.js.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, runCli, mkTmp, rmrf, FIXTURE_SKILLS } = require('./harness')
const { parseArgs } = require('../lib/cli')

console.log('--- cli ---')

// --- help ---

test('help lists all commands and options', () => {
  const { stdout } = runCli(['--help'], { isolate: false })
  for (const token of ['install', 'uninstall', 'setup-env', 'list', '--claude', '--codex', '--openclaw', '--setup-env']) {
    assert(stdout.includes(token), `help missing ${token}`)
  }
})

test('-h aliases to help', () => {
  const { stdout } = runCli(['-h'], { isolate: false })
  assert(stdout.includes('Usage'), '-h did not show help')
})

test('help documents the version flag and the "no slug means all" rule', () => {
  const { stdout } = runCli(['help'], { isolate: false })
  assert(stdout.includes('--version'), 'help does not mention --version')
  assert(/Naming no skill means every skill/.test(stdout), 'help does not explain the default slug set')
})

// --- version ---

test('--version prints one constant first line and exits 0', () => {
  const { stdout, code } = runCli(['--version'])
  const lines = stdout.split('\n').filter(l => l.trim() !== '')
  assert.strictEqual(code, 0, `expected exit 0, got ${code}`)
  assert.strictEqual(lines.length, 1, `expected exactly one output line, got ${lines.length}`)
  const pkg = require('../package.json')
  assert.strictEqual(lines[0].trim(), `${pkg.name} ${pkg.version}`)
})

test('-v aliases to --version', () => {
  const { stdout } = runCli(['-v'])
  assert(/^skill-factory \d+\.\d+\.\d+$/.test(stdout.trim()), `unexpected -v output: ${stdout.trim()}`)
})

// Regression: --version was not in the command table, so the command fell back
// to 'install' and `node bin/cli.js --version` silently installed into the real
// ~/.claude and ~/.codex.
test('--version installs nothing', () => {
  const home = mkTmp('sf-ver-')
  runCli(['--version'], { home, keepHome: true })
  assert(!fs.existsSync(path.join(home, '.claude')), '--version created ~/.claude')
  assert(!fs.existsSync(path.join(home, '.codex')), '--version created ~/.codex')
  rmrf(home)
})

// Regression: target resolution ran unconditionally at module load, so `--help`
// scanned C:/D:/E:/F: for OpenClaw roots and realpath'd them — a disconnected or
// sleeping drive letter could hang or throw on a pure help request.
test('help resolves no targets and writes nothing', () => {
  const home = mkTmp('sf-help-')
  // Drive scan deliberately left ENABLED: if help resolved targets, this is
  // where it would happen.
  const { code } = runCli(['--help'], {
    home,
    keepHome: true,
    extraEnv: { SKILL_FACTORY_NO_DRIVE_SCAN: '', WIN_ENCODING_FIX_NO_DRIVE_SCAN: '' }
  })
  assert.strictEqual(code, 0, `help exited ${code}`)
  assert(!fs.existsSync(path.join(home, '.claude')), 'help created ~/.claude')
  rmrf(home)
})

// --- banner ---

test('banner shows the Chinese product name (UTF-8 round-trip canary)', () => {
  const { stdout } = runCli(['list'])
  assert(stdout.includes('Skill 工厂'), `banner lost its CJK: ${stdout.split('\n')[1]}`)
})

// --- list ---

test('list prints every slug with its version', () => {
  const { stdout, code } = runCli(['list'], { extraEnv: { SKILL_FACTORY_SKILLS_DIR: FIXTURE_SKILLS } })
  assert.strictEqual(code, 0, `list exited ${code}`)
  assert(/\balpha\b/.test(stdout), 'alpha missing from list')
  assert(/\bbeta\b/.test(stdout), 'beta missing from list')
  assert(stdout.includes('0.1.0'), "alpha's version missing")
  assert(stdout.includes('2.10.3'), "beta's version missing")
})

// --- dispatch and exit codes ---

test('unknown command exits non-zero', () => {
  const { stdout, code } = runCli(['bogus-cmd'])
  assert(stdout.includes('Unknown command'), 'no unknown-command notice')
  assert(stdout.includes('Usage'), 'help not shown')
  assert.strictEqual(code, 1, `expected exit 1, got ${code}`)
})

test('unknown option exits non-zero and names the option', () => {
  const { stdout, code } = runCli(['install', '--setupenv'])
  assert(stdout.includes('Unknown option: --setupenv'), 'the misspelled flag was not named')
  assert.strictEqual(code, 1, `expected exit 1, got ${code}`)
  assert(!stdout.includes('Installing skill files'), 'it installed anyway')
})

test('no-arg invocation defaults to install', () => {
  const { stdout } = runCli([])
  assert(stdout.includes('Installing skill files'), 'bare invocation did not default to install')
})

// --- parseArgs (in-process) ---

// Regression: flags were collected with a filter, so the VALUE of a space-form
// flag stayed a positional. With the command omitted, `--claude D:\x` made D:\x
// the command: "Unknown command: D:\x".
test('parseArgs consumes space-form flag values so they never become the command', () => {
  const parsed = parseArgs(['--claude', 'D:\\x', '--codex', 'E:\\y'])
  assert.strictEqual(parsed.command, 'install', `command became ${parsed.command}`)
  assert.strictEqual(parsed.claude, 'D:\\x')
  assert.strictEqual(parsed.codex, 'E:\\y')
  assert.deepStrictEqual(parsed.slugs, [])
})

test('parseArgs splits the command from the skill slugs', () => {
  const parsed = parseArgs(['install', 'alpha', 'beta', '--setup-env'])
  assert.strictEqual(parsed.command, 'install')
  assert.deepStrictEqual(parsed.slugs, ['alpha', 'beta'])
  assert.strictEqual(parsed.setupEnv, true)
})

test('parseArgs warns instead of silently defaulting when a path flag has no value', () => {
  const parsed = parseArgs(['install', '--claude'])
  assert.strictEqual(parsed.claude, null)
  assert.strictEqual(parsed.warnings.length, 1, 'expected exactly one warning')
  assert(/--claude given without a path/.test(parsed.warnings[0]), parsed.warnings[0])
})

test('parseArgs reports unrecognised flags rather than ignoring them', () => {
  const parsed = parseArgs(['install', '--nope', '--claude=D:\\x'])
  assert.deepStrictEqual(parsed.unknownFlags, ['--nope'])
  assert.strictEqual(parsed.claude, 'D:\\x', 'a valid flag after the bad one was dropped')
})
