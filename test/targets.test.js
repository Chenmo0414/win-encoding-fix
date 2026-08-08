'use strict'

// Where each assistant keeps its skills. All in-process: resolveTargets takes
// env and home as parameters, so these cases never spawn and never depend on the
// real machine.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, mkTmp, rmrf } = require('./harness')
const { resolveTargets, detectOpenclawSkillsRoots } = require('../lib/targets')

console.log('--- targets ---')

const SEALED = { SKILL_FACTORY_NO_DRIVE_SCAN: '1' }

function byName(targets, name) {
  return targets.filter(t => t.name === name)
}

test('claude and codex resolve under the injected home', () => {
  const home = path.join('X:', 'fake-home')
  const targets = resolveTargets({ home, env: SEALED })
  assert.strictEqual(byName(targets, 'claude')[0].skillsRoot, path.join(home, '.claude', 'skills'))
  assert.strictEqual(byName(targets, 'codex')[0].skillsRoot, path.join(home, '.codex', 'skills'))
})

test('targets are slug-independent: every skillsRoot ends with "skills"', () => {
  const targets = resolveTargets({ home: path.join('X:', 'h'), env: SEALED })
  for (const t of targets) {
    if (!t.skillsRoot) continue
    assert.strictEqual(path.basename(t.skillsRoot), 'skills', `${t.name}: ${t.skillsRoot}`)
  }
})

test('custom --claude/--codex/--openclaw paths win over the defaults', () => {
  const targets = resolveTargets({
    home: path.join('X:', 'h'),
    env: SEALED,
    claude: path.join('D:', 'c'),
    codex: path.join('E:', 'x'),
    openclaw: path.join('F:', 'o')
  })
  assert.strictEqual(byName(targets, 'claude')[0].skillsRoot, path.join('D:', 'c', 'skills'))
  assert.strictEqual(byName(targets, 'codex')[0].skillsRoot, path.join('E:', 'x', 'skills'))
  assert.strictEqual(byName(targets, 'openclaw')[0].skillsRoot, path.join('F:', 'o', 'workspace', 'skills'))
})

test('OPENCLAW_HOME is detected when its skills dir exists', () => {
  const root = mkTmp('sf-oc-')
  const ocSkills = path.join(root, 'oc', 'workspace', 'skills')
  fs.mkdirSync(ocSkills, { recursive: true })
  const targets = resolveTargets({
    home: path.join(root, 'h'),
    env: { ...SEALED, OPENCLAW_HOME: path.join(root, 'oc') }
  })
  assert.deepStrictEqual(byName(targets, 'openclaw').map(t => t.skillsRoot), [ocSkills])
  rmrf(root)
})

test('openclaw resolves to null when nothing is detected', () => {
  const root = mkTmp('sf-nooc-')
  const targets = resolveTargets({
    home: path.join(root, 'h'),
    env: { ...SEALED, OPENCLAW_HOME: path.join(root, 'nope') }
  })
  assert.deepStrictEqual(byName(targets, 'openclaw').map(t => t.skillsRoot), [null])
  rmrf(root)
})

test('drive scan is gated by SKILL_FACTORY_NO_DRIVE_SCAN', () => {
  const root = mkTmp('sf-scan-')
  const sealed = detectOpenclawSkillsRoots({
    home: path.join(root, 'h'),
    env: { SKILL_FACTORY_NO_DRIVE_SCAN: '1', OPENCLAW_HOME: path.join(root, 'nope') }
  })
  assert.deepStrictEqual(sealed, [], `sealed scan found ${JSON.stringify(sealed)}`)
  rmrf(root)
})

// The legacy spelling must keep gating forever. If it silently stopped, a
// "sealed" test would start scanning the machine's real drives again.
test('drive scan is gated by the legacy WIN_ENCODING_FIX_NO_DRIVE_SCAN', () => {
  const root = mkTmp('sf-scan2-')
  const sealed = detectOpenclawSkillsRoots({
    home: path.join(root, 'h'),
    env: { WIN_ENCODING_FIX_NO_DRIVE_SCAN: '1', OPENCLAW_HOME: path.join(root, 'nope') }
  })
  assert.deepStrictEqual(sealed, [], `legacy gate did not seal: ${JSON.stringify(sealed)}`)
  rmrf(root)
})

test('roots that realpath to the same location are deduped', () => {
  const root = mkTmp('sf-dedup-')
  const skills = path.join(root, 'oc', 'workspace', 'skills')
  fs.mkdirSync(skills, { recursive: true })
  // OPENCLAW_HOME and HOME/.openclaw both point at the same physical directory.
  const found = detectOpenclawSkillsRoots({
    home: root,
    env: { ...SEALED, OPENCLAW_HOME: path.join(root, 'oc') }
  })
  fs.mkdirSync(path.join(root, '.openclaw', 'workspace'), { recursive: true })
  const dupTarget = path.join(root, '.openclaw', 'workspace', 'skills')
  let linked = false
  try {
    fs.symlinkSync(skills, dupTarget, 'junction')
    linked = true
  } catch {}
  const after = detectOpenclawSkillsRoots({
    home: root,
    env: { ...SEALED, OPENCLAW_HOME: path.join(root, 'oc') }
  })
  assert.strictEqual(found.length, 1, 'baseline should find exactly one root')
  if (linked) {
    assert.strictEqual(after.length, 1, `junction to the same dir was not deduped: ${JSON.stringify(after)}`)
  } else {
    // No symlink privileges (common on Windows without developer mode): the
    // dedupe path can't be exercised, but the plain case must still hold.
    assert.strictEqual(after.length, 1, 'unexpected extra root without a link')
  }
  rmrf(root)
})

test('multiple distinct openclaw roots all become targets', () => {
  const root = mkTmp('sf-multi-')
  const a = path.join(root, 'a', 'workspace', 'skills')
  const b = path.join(root, 'b', '.openclaw', 'workspace', 'skills')
  fs.mkdirSync(a, { recursive: true })
  fs.mkdirSync(b, { recursive: true })
  const found = detectOpenclawSkillsRoots({
    home: path.join(root, 'b'),
    env: { ...SEALED, OPENCLAW_HOME: path.join(root, 'a') }
  })
  assert.deepStrictEqual(found, [a, b], `expected both roots, got ${JSON.stringify(found)}`)
  rmrf(root)
})
