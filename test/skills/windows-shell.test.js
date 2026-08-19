'use strict'

// Content guards specific to the windows-shell skill. Generic per-skill
// contracts (name == slug, semver, CHANGELOG head) live in ../skills.test.js and
// apply to every skill automatically; this file is only for what is true of
// THIS skill's text.
//
// Since 5.0.0 the skill uses progressive disclosure: SKILL.md is a routing table
// and the detail lives in references/. The guards below protect BOTH halves of
// that contract — the core must stay small, and every pointer must resolve.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, ROOT } = require('../harness')
const { parseFrontmatter } = require('../../lib/skills')
const { GIT_CONFIG_KEYS } = require('../../lib/setup-env')

console.log('--- skills/windows-shell ---')

const SKILL_DIR = path.join(ROOT, 'skills', 'windows-shell')
const REF_DIR = path.join(SKILL_DIR, 'references')
const src = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8')
const refFiles = fs.existsSync(REF_DIR) ? fs.readdirSync(REF_DIR).filter(f => f.endsWith('.md')) : []
const allText = src + refFiles.map(f => fs.readFileSync(path.join(REF_DIR, f), 'utf-8')).join('\n')

test('frontmatter has name, version (semver), description and license', () => {
  const meta = parseFrontmatter(src)
  assert.strictEqual(meta.name, 'windows-shell')
  assert(/^\d+\.\d+\.\d+$/.test(meta.version || ''), `version "${meta.version}" is not semver`)
  assert((meta.description || '').length > 0, 'description missing')
  assert((meta.license || '').length > 0, 'license missing')
})

// --- progressive disclosure contract ---

// The whole point of 5.0.0 is that the always-loaded half stays cheap. Measured:
// the pre-split skill was 28KB across two skills; letting SKILL.md drift back
// toward that silently undoes the optimisation, so the ceiling is asserted.
test('SKILL.md stays small enough to always load', () => {
  const bytes = Buffer.byteLength(src, 'utf-8')
  assert(bytes < 9000, `SKILL.md grew to ${bytes} bytes — move detail into references/`)
})

test('references/ exists and carries the bulk of the detail', () => {
  assert(refFiles.length >= 4, `expected at least 4 reference files, found ${refFiles.length}`)
  const refBytes = refFiles.reduce(
    (n, f) => n + fs.statSync(path.join(REF_DIR, f)).size, 0)
  assert(refBytes > Buffer.byteLength(src, 'utf-8'),
    'references/ should hold more than the core file, otherwise the split bought nothing')
})

test('every references/ link in SKILL.md resolves to a real file', () => {
  const links = [...src.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)].map(m => m[1])
  assert(links.length > 0, 'SKILL.md points at no references at all')
  for (const l of new Set(links)) {
    assert(fs.existsSync(path.join(REF_DIR, l)), `dangling pointer: references/${l}`)
  }
})

test('every reference file is reachable from SKILL.md', () => {
  for (const f of refFiles) {
    assert(src.includes(f), `references/${f} is an orphan — nothing points at it`)
  }
})

// --- content guards (across core + references) ---

// These are the escape hatches the skill exists to deliver. Each one measurably
// changed agent behaviour in the A/B runs; losing any of them guts the skill.
test('the load-bearing escape hatches survive somewhere in the bundle', () => {
  const hatches = [
    'MSYS_NO_PATHCONV',            // 参数被静默改写 —— A/B 中唯一 100% 分离的指标
    'winsymlinks:nativestrict',    // ln -s 退化成副本
    'GetEncoding(936)',            // GBK 遗留文件
    'utf8NoBOM',                   // 无 BOM 写出
    'PIPESTATUS',                  // 管道吞退出码
    '.venv/Scripts/python.exe',    // 绕开 activate
    '-X utf8',                     // 不依赖环境的 Python 编码
  ]
  for (const h of hatches) {
    assert(allText.includes(h), `escape hatch missing from the whole bundle: ${h}`)
  }
})

// The two-class diagnosis (mojibake vs argument rewriting) is the skill's core
// mental model — misdiagnosing sends you down a dead end no amount of encoding
// prefixes can fix. It must be in the ALWAYS-loaded half.
test('SKILL.md itself teaches the two-class diagnosis', () => {
  assert(/两类|编码/.test(src), 'SKILL.md lost the encoding class')
  assert(src.includes('MSYS_NO_PATHCONV'), 'SKILL.md lost the argument-rewriting fix')
})

// Elevation cannot be clicked by an agent; this rule prevents a hung session.
test('SKILL.md routes elevation to a human', () => {
  assert(src.includes('UAC'), 'missing UAC guidance')
  assert(/交给人/.test(src), 'does not hand elevation to a human')
})

test('SKILL.md keeps the 环境前置条件 guidance', () => {
  assert(/PYTHONUTF8/.test(src), 'lost the PYTHONUTF8 setup')
  assert(/User/.test(src), 'lost the User-level env var point')
})

// Only the KEYS are compared, never the quoting. The skill documents the bash
// form while lib/setup-env.js passes argv arrays. That difference is deliberate
// and load-bearing: "unifying" them is how the v4.2.0 cmd.exe quote-eating bug
// would come back.
test('the git keys documented in the bundle match the ones setup-env writes', () => {
  const missing = GIT_CONFIG_KEYS.filter(key => !allText.includes(key))
  assert.strictEqual(missing.length, 0, `bundle does not document: ${missing.join(', ')}`)
})

// `npx win-encoding-fix install --setup-env` shipped for three versions and
// never worked: the package was never on npm, and npx resolves package NAMES,
// not bin names. Nothing may advertise an npx install of this repo again.
test('nothing advertises an npx install of this factory', () => {
  const ads = allText.match(/npx\s+(?:skill-factory|win-encoding-fix|windows-shell\S*)/g) || []
  assert.deepStrictEqual(ads, [], `bundle advertises an unpublished install: ${ads.join(', ')}`)
})

test('SKILL.md and every reference are LF-only and BOM-free', () => {
  for (const rel of ['SKILL.md', ...refFiles.map(f => path.join('references', f))]) {
    const buf = fs.readFileSync(path.join(SKILL_DIR, rel))
    assert(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), `${rel} has a UTF-8 BOM`)
    assert(!buf.includes(0x0d), `${rel} contains CR`)
  }
})
