'use strict'

/**
 * Zero-dependency test harness. No framework, no node:test — the engines floor
 * is node >=14.14, and adding a dev dependency to a repo that copies markdown
 * around is not worth it.
 *
 * SAFETY: every runCli invocation runs against an isolated temp HOME with
 * OPENCLAW_HOME pointed into that temp and git global config redirected, so a
 * test can NEVER touch the real ~/.claude, ~/.codex, ~/.openclaw, ~/.bash_profile
 * or the user's global git config — even the default-detection tests.
 *
 * Counters live in module scope, so every test file that requires this harness
 * contributes to one shared tally. test/run.js is what makes that safe: it
 * verifies each file actually registered cases, so a file that throws while
 * being required cannot vanish from the count and leave the suite green.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const CLI = path.join(ROOT, 'bin', 'cli.js')
const FIXTURE_SKILLS = path.join(__dirname, 'fixtures', 'skills')

const state = { passed: 0, failed: 0, failures: [] }

function test(name, fn) {
  try {
    fn()
    state.passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    state.failed++
    state.failures.push({ name, err })
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n')[0]}`)
  }
}

function total() {
  return state.passed + state.failed
}

function fail(name, message) {
  state.failed++
  state.failures.push({ name, err: new Error(message) })
  console.log(`  ✗ ${name}\n      ${message}`)
}

function summary() {
  console.log(`\n${state.passed} passed, ${state.failed} failed\n`)
  if (state.failed > 0) {
    for (const f of state.failures) {
      console.log(`FAIL: ${f.name}`)
      console.log(f.err.stack || f.err.message)
      console.log('')
    }
    return 1
  }
  return 0
}

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
}

// Run the CLI. By default it is fully isolated: HOME/USERPROFILE point at a
// throwaway temp dir, OPENCLAW_HOME points into it (so the drive scan can't
// reach a real .openclaw unless a caller opts in), git global config is
// redirected, and the Windows-User-env branch is skipped. Pass
// { isolate: false } only for tests that spawn no filesystem side effects.
// Pass extraEnv to override individual vars.
//
// Both spellings of each escape hatch are set. The legacy WIN_ENCODING_FIX_*
// names must keep working: if SKIP_WINENV ever stopped gating, setupEnv would
// really call SetEnvironmentVariable(..., 'User'), which broadcasts
// WM_SETTINGCHANGE and can hang — during `npm test`.
function runCli(args, opts = {}) {
  const { isolate = true, extraEnv = {} } = opts
  let home = opts.home
  let cleanupHome = false
  const baseEnv = { ...process.env }

  if (isolate) {
    if (!home) { home = mkTmp('sf-iso-'); cleanupHome = true }
    Object.assign(baseEnv, {
      HOME: home,
      USERPROFILE: home,
      OPENCLAW_HOME: path.join(home, '.no-openclaw'),
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig-test'),
      SKILL_FACTORY_SKIP_WINENV: '1',
      SKILL_FACTORY_NO_DRIVE_SCAN: '1',
      WIN_ENCODING_FIX_SKIP_WINENV: '1',
      WIN_ENCODING_FIX_NO_DRIVE_SCAN: '1'
    })
  }
  const env = { ...baseEnv, ...extraEnv }

  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { stdout, stderr: '', code: 0, home }
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status, home }
  } finally {
    if (cleanupHome && !opts.keepHome) rmrf(home)
  }
}

module.exports = { test, fail, total, summary, mkTmp, rmrf, runCli, ROOT, CLI, FIXTURE_SKILLS }
