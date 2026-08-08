'use strict'

// Content guards specific to the windows-shell skill. Generic per-skill
// contracts (name == slug, semver, CHANGELOG head) live in ../skills.test.js and
// apply to every skill automatically; this file is only for what is true of
// THIS skill's text.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, ROOT } = require('../harness')
const { parseFrontmatter } = require('../../lib/skills')
const { GIT_CONFIG_KEYS } = require('../../lib/setup-env')

console.log('--- skills/windows-shell ---')

const SKILL_DIR = path.join(ROOT, 'skills', 'windows-shell')
const src = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8')

test('frontmatter has name, version (semver), description and license', () => {
  const meta = parseFrontmatter(src)
  assert.strictEqual(meta.name, 'windows-shell')
  assert(/^\d+\.\d+\.\d+$/.test(meta.version || ''), `version "${meta.version}" is not semver`)
  assert((meta.description || '').length > 0, 'description missing')
  assert((meta.license || '').length > 0, 'license missing')
})

// Truncation guard. The Chinese literals double as a check that the file is
// still being read as UTF-8.
test('SKILL.md keeps its 8 numbered rules', () => {
  for (let n = 1; n <= 8; n++) {
    assert(new RegExp(`### 规则 ${n}`).test(src), `missing 规则 ${n}`)
  }
})

test('SKILL.md keeps the 环境前置条件 section', () => {
  assert(src.includes('## 环境前置条件'), 'missing 环境前置条件 section')
})

// Only the KEYS are compared, never the quoting. SKILL.md documents the bash
// form (`git config --global core.pager "less -R"`, double quotes, correct when
// bash invokes git directly) while lib/setup-env.js passes argv arrays. That
// difference is deliberate and load-bearing: "unifying" them is how the v4.2.0
// cmd.exe quote-eating bug would come back.
test('the git keys documented in SKILL.md match the ones setup-env writes', () => {
  const missing = GIT_CONFIG_KEYS.filter(key => !src.includes(key))
  assert.strictEqual(missing.length, 0, `SKILL.md does not document: ${missing.join(', ')}`)
})

test('SKILL.md is LF-only and BOM-free', () => {
  const buf = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'))
  assert(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), 'SKILL.md has a UTF-8 BOM')
  assert(!buf.includes(0x0d), 'SKILL.md contains CR')
})
