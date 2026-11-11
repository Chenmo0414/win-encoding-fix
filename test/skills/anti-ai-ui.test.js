'use strict'

// Content guards specific to the anti-ai-ui skill. Generic per-skill contracts
// (name == slug, semver, CHANGELOG head) live in ../skills.test.js; this file is
// only for what is true of THIS skill's text.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, ROOT } = require('../harness')
const { parseFrontmatter } = require('../../lib/skills')

console.log('--- skills/anti-ai-ui ---')

const SKILL_DIR = path.join(ROOT, 'skills', 'anti-ai-ui')
const REF_DIR = path.join(SKILL_DIR, 'references')
const src = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8')
const refFiles = fs.existsSync(REF_DIR) ? fs.readdirSync(REF_DIR).filter(f => f.endsWith('.md')) : []
const readRef = f => fs.readFileSync(path.join(REF_DIR, f), 'utf-8')

test('frontmatter has name, version (semver), description and license', () => {
  const meta = parseFrontmatter(src)
  assert.strictEqual(meta.name, 'anti-ai-ui')
  assert(/^\d+\.\d+\.\d+$/.test(meta.version || ''), `version "${meta.version}" is not semver`)
  assert((meta.description || '').length > 0, 'description missing')
  assert(meta.description.length <= 1024, `description is ${meta.description.length} chars, over the 1024 limit`)
  assert((meta.license || '').length > 0, 'license missing')
})

// The description is the only thing an assistant sees before deciding to load
// the skill. All-Chinese triggers silently miss English requests.
test('description carries English trigger words as well as Chinese', () => {
  const d = parseFrontmatter(src).description
  assert(/AI 味/.test(d), 'lost the Chinese trigger')
  assert(/generic|template/i.test(d), 'no English trigger words')
})

test('SKILL.md stays small enough to always load', () => {
  const bytes = Buffer.byteLength(src, 'utf-8')
  assert(bytes < 9000, `SKILL.md grew to ${bytes} bytes — move detail into references/`)
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

// The anti-pattern table is numbered 01..18 and the CHANGELOG/README advertise
// "18 类". Keep the count and the claim in step.
test('anti-patterns.md has exactly the 18 numbered rows the docs advertise', () => {
  const rows = [...readRef('anti-patterns.md').matchAll(/^\| (\d{2}) \|/gm)].map(m => Number(m[1]))
  assert.deepStrictEqual(rows, Array.from({ length: 18 }, (_, i) => i + 1))
  assert(fs.readFileSync(path.join(SKILL_DIR, 'CHANGELOG.md'), 'utf-8').includes('18 类'))
})

// Every S-number cited in the tables must be defined in sources.md, and every
// defined source must be cited somewhere — no dangling or dead citations.
test('source citations S1..Sn and their definitions match both ways', () => {
  const sources = readRef('sources.md')
  const defined = new Set([...sources.matchAll(/^\| (S\d+) \|/gm)].map(m => m[1]))
  const cited = new Set()
  for (const f of refFiles.filter(f => f !== 'sources.md')) {
    for (const m of readRef(f).matchAll(/\bS\d+\b/g)) cited.add(m[0])
  }
  for (const s of cited) assert(defined.has(s), `${s} is cited but not defined in sources.md`)
  for (const s of defined) assert(cited.has(s), `${s} is defined but never cited`)
})

// The skill's own guardrails against the over-correction it could cause. If
// these go, "去 AI 味" turns into a blanket rewrite that deletes real information.
test('the load-bearing exceptions survive in SKILL.md', () => {
  assert(/不要全局删除 `border-left`/.test(src), 'lost the "do not blanket-remove border-left" guard')
  assert(/不能把信息爆炸简单改成“所有东西都折叠”/.test(src), 'lost the "do not collapse everything" guard')
  assert(/不要为了“去 AI 味”把真实的不确定性改成肯定语气/.test(src), 'lost the honest-uncertainty guard')
  assert(/不能.*量化“AI 含量”|声称能够量化“AI 含量”/.test(src), 'lost the "no AI-score" disclaimer')
})

test('SKILL.md and every reference are LF-only and BOM-free', () => {
  for (const rel of ['SKILL.md', 'CHANGELOG.md', ...refFiles.map(f => path.join('references', f))]) {
    const buf = fs.readFileSync(path.join(SKILL_DIR, rel))
    assert(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), `${rel} has a UTF-8 BOM`)
    assert(!buf.includes(0x0d), `${rel} contains CR`)
  }
})
