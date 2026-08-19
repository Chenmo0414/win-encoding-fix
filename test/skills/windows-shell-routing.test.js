'use strict'

// Content guards specific to the windows-shell-routing skill. Generic per-skill
// contracts (name == slug, semver, CHANGELOG head, .md-only) live in
// ../skills.test.js and apply to every skill automatically; this file is only
// for what is true of THIS skill's text.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, ROOT } = require('../harness')
const { parseFrontmatter } = require('../../lib/skills')

console.log('--- skills/windows-shell-routing ---')

const SKILL_DIR = path.join(ROOT, 'skills', 'windows-shell-routing')
const src = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8')

test('frontmatter has name, version (semver), description and license', () => {
  const meta = parseFrontmatter(src)
  assert.strictEqual(meta.name, 'windows-shell-routing')
  assert(/^\d+\.\d+\.\d+$/.test(meta.version || ''), `version "${meta.version}" is not semver`)
  assert((meta.description || '').length > 0, 'description missing')
  assert.strictEqual(meta.license, 'MIT')
})

// The name states the domain; the STANCE ("default to Git Bash") has to live in
// the description, because that is what the assistant matches on. A rename that
// drops the stance from the description would silently make the skill stop
// being picked for "which shell should I use" questions.
test('description carries the default-to-Git-Bash stance', () => {
  const meta = parseFrontmatter(src)
  assert(/Git Bash/.test(meta.description), 'description does not name Git Bash')
  assert(/默认/.test(meta.description), 'description does not state a default')
})

// This skill deliberately does NOT restate encoding rules; it points at the
// companion skill instead. If that pointer disappears, the two skills have
// drifted into overlapping scope.
test('it defers encoding concerns to the windows-shell skill', () => {
  assert(src.includes('windows-shell'), 'no reference to the companion windows-shell skill')
})

test('the decision table covers all three shells', () => {
  assert(src.includes('## 决策表'), 'missing 决策表 section')
  for (const shell of ['Git Bash', 'PowerShell', 'WSL']) {
    assert(src.includes(shell), `decision table does not mention ${shell}`)
  }
})

test('all five Git Bash pitfalls are present', () => {
  for (let n = 1; n <= 5; n++) {
    assert(new RegExp(`### 坑 ${n}`).test(src), `missing 坑 ${n}`)
  }
})

// Each pitfall is only useful with its escape hatch. These four strings are the
// actionable half of the skill; losing one turns a warning into a dead end.
test('every pitfall ships its escape hatch', () => {
  const hatches = {
    'MSYS_NO_PATHCONV': '参数改写',
    'winsymlinks:nativestrict': '符号链接',
    '.venv/Scripts/python.exe': 'venv activate',
    'chmod 600': 'SSH 密钥权限'
  }
  for (const [token, why] of Object.entries(hatches)) {
    assert(src.includes(token), `missing escape hatch for ${why}: ${token}`)
  }
})

// wsl.exe swallows shell variables when a script is passed via `bash -c`, and
// still exits 0. Anyone routed to WSL by this skill must be told to use stdin.
test('it warns about the wsl.exe variable-swallowing trap', () => {
  assert(src.includes('bash -s'), 'missing the `bash -s` stdin workaround')
})

// UAC cannot be clicked by an agent, so "try to elevate" is never the right
// instruction. This rule is the one that prevents a hung session.
test('elevation is routed to a human, not attempted', () => {
  assert(src.includes('UAC'), 'missing UAC guidance')
  assert(/交给人/.test(src), 'does not tell the agent to hand elevation to a human')
})

// windows-shell bans EVERY `npx …` because its only npx line was an install
// ad for a package that was never published. Here the rule has to be narrower:
// this skill legitimately shows `npx vitest` / `npx tsc` as task commands, so
// only an install ad for THIS repo's own package names is forbidden.
test('SKILL.md advertises no npx install of this factory', () => {
  const ads = src.match(/npx\s+(?:skill-factory|win-encoding-fix|windows-shell\S*)/g) || []
  assert.deepStrictEqual(ads, [], `SKILL.md advertises an unpublished install: ${ads.join(', ')}`)
})

test('SKILL.md is LF-only and BOM-free', () => {
  const buf = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'))
  assert(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), 'SKILL.md has a UTF-8 BOM')
  assert(!buf.includes(0x0d), 'SKILL.md contains CR')
})
