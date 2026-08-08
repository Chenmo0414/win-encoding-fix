'use strict'

// The registry: discovery, frontmatter parsing, and the per-skill contract.
//
// The contract block is DATA-DRIVEN over the real registry, so every skill added
// to this factory in future is automatically covered without touching this file.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const { test, mkTmp, rmrf, FIXTURE_SKILLS } = require('./harness')
const { listSkills, parseFrontmatter, readMeta, resolveSlugs } = require('../lib/skills')

console.log('--- skills ---')

// --- discovery ---

test('discovery returns the fixture skills in byte order', () => {
  const skills = listSkills(FIXTURE_SKILLS)
  assert.deepStrictEqual(skills.map(s => s.slug), ['alpha', 'beta'])
})

test('windows-shell is present in the real catalog', () => {
  // Anchor: protects the already-published ClawHub slug against an accidental
  // rename or deletion of skills/windows-shell/.
  const slugs = listSkills().map(s => s.slug)
  assert(slugs.includes('windows-shell'), `catalog is ${JSON.stringify(slugs)}`)
})

test('discovery skips a directory without SKILL.md', () => {
  const root = mkTmp('sf-nodoc-')
  fs.mkdirSync(path.join(root, 'real'), { recursive: true })
  fs.writeFileSync(path.join(root, 'real', 'SKILL.md'), '---\nname: real\n---\n')
  fs.mkdirSync(path.join(root, 'notaskill'), { recursive: true })
  fs.writeFileSync(path.join(root, 'notaskill', 'README.md'), 'x')
  assert.deepStrictEqual(listSkills(root).map(s => s.slug), ['real'])
  rmrf(root)
})

test('discovery skips dot- and underscore-prefixed directories', () => {
  const root = mkTmp('sf-hidden-')
  for (const name of ['ok', '.hidden', '_wip']) {
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  assert.deepStrictEqual(listSkills(root).map(s => s.slug), ['ok'])
  rmrf(root)
})

// skills/ is also ClawHub's default managed directory. A skill installed there
// by `clawhub install` is not ours to re-publish or push into the user's
// ~/.claude, and it carries .clawhub/origin.json to say so.
test('discovery skips a clawhub-managed directory (.clawhub/origin.json)', () => {
  const root = mkTmp('sf-managed-')
  for (const name of ['mine', 'theirs']) {
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  fs.mkdirSync(path.join(root, 'theirs', '.clawhub'), { recursive: true })
  fs.writeFileSync(path.join(root, 'theirs', '.clawhub', 'origin.json'), '{}')
  assert.deepStrictEqual(listSkills(root).map(s => s.slug), ['mine'])
  rmrf(root)
})

test('discovery on a missing directory returns empty rather than throwing', () => {
  assert.deepStrictEqual(listSkills(path.join(mkTmp('sf-gone-'), 'nope')), [])
})

// --- frontmatter ---

test('parseFrontmatter reads top-level scalars and skips nested keys', () => {
  const meta = parseFrontmatter([
    '---',
    'name: alpha',
    'version: 0.1.0',
    'license: MIT',
    'metadata:',
    '  openclaw:',
    '    emoji: "x"',
    '---',
    '',
    '# body'
  ].join('\n'))
  assert.strictEqual(meta.name, 'alpha')
  assert.strictEqual(meta.version, '0.1.0')
  assert.strictEqual(meta.license, 'MIT')
  assert.strictEqual(meta.emoji, undefined, 'a nested key leaked into the flat result')
})

test('parseFrontmatter handles CRLF input', () => {
  const meta = parseFrontmatter('---\r\nname: crlf\r\nversion: 1.0.0\r\n---\r\n\r\nbody\r\n')
  assert.strictEqual(meta.name, 'crlf')
  assert.strictEqual(meta.version, '1.0.0')
})

test('parseFrontmatter keeps a quoted Chinese description containing a colon intact', () => {
  const meta = parseFrontmatter('---\ndescription: "编码规范：覆盖 GBK/UTF-8"\n---\n')
  assert.strictEqual(meta.description, '编码规范：覆盖 GBK/UTF-8')
})

test('parseFrontmatter strips single quotes too', () => {
  assert.strictEqual(parseFrontmatter("---\ndescription: 'x: y'\n---\n").description, 'x: y')
})

// The old frontmatter check used /\bversion:\s*([0-9.]+)/ against the WHOLE
// file, so a `version:` line anywhere in the body could satisfy it.
test('parseFrontmatter ignores a version line that appears in the body', () => {
  const meta = readMeta({ dir: path.join(FIXTURE_SKILLS, 'beta') })
  assert.strictEqual(meta.version, '2.10.3', 'the body version leaked in')
})

test('parseFrontmatter returns empty for a file with no frontmatter', () => {
  assert.deepStrictEqual(parseFrontmatter('# just a heading\n'), {})
})

// Without a BOM strip, ^--- never anchors and the WHOLE frontmatter parses as
// {} — surfacing later as the baffling `version "undefined" is not semver`
// rather than "your file has a BOM". Windows editors add one readily, and this
// repo is about exactly that class of problem.
test('parseFrontmatter tolerates a UTF-8 BOM before the frontmatter', () => {
  const meta = parseFrontmatter('﻿---\nname: bommed\nversion: 1.2.3\n---\n\nbody\n')
  assert.strictEqual(meta.name, 'bommed')
  assert.strictEqual(meta.version, '1.2.3')
})

test('a skill whose SKILL.md carries a BOM still resolves its metadata', () => {
  const root = mkTmp('sf-bom-')
  fs.mkdirSync(path.join(root, 'bommed'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'bommed', 'SKILL.md'),
    '﻿---\nname: bommed\nversion: 4.5.6\ndescription: x\nlicense: MIT\n---\n\n# x\n',
    'utf-8'
  )
  const [skill] = listSkills(root)
  assert(skill, 'BOM-prefixed skill was not discovered')
  assert.strictEqual(readMeta(skill).version, '4.5.6')
  rmrf(root)
})

// --- per-skill contract, data-driven over the REAL registry ---

const realSkills = listSkills()

test('every skill frontmatter name equals its directory name', () => {
  // This is what protects a published ClawHub slug: directory name == slug ==
  // frontmatter name, all three enforced here.
  for (const skill of realSkills) {
    assert.strictEqual(readMeta(skill).name, skill.slug, `${skill.slug}: frontmatter name mismatch`)
  }
})

test('every skill has a semver version, a description and a license', () => {
  for (const skill of realSkills) {
    const meta = readMeta(skill)
    assert(/^\d+\.\d+\.\d+$/.test(meta.version || ''), `${skill.slug}: version "${meta.version}" is not semver`)
    assert((meta.description || '').trim().length > 0, `${skill.slug}: empty description`)
    assert((meta.license || '').trim().length > 0, `${skill.slug}: empty license`)
  }
})

// Replaces the old `pkg.version === SKILL.md version` assertion, which is
// structurally impossible with N skills — and which was the wrong coupling
// anyway: it is what forced CLI-only changes to bump a skill's published
// version, and it left the publish script shipping a frozen changelog.
test('every skill CHANGELOG top section matches its frontmatter version', () => {
  for (const skill of realSkills) {
    const changelogPath = path.join(skill.dir, 'CHANGELOG.md')
    assert(fs.existsSync(changelogPath), `${skill.slug}: no CHANGELOG.md`)
    const head = fs.readFileSync(changelogPath, 'utf-8').match(/^## (\d+\.\d+\.\d+)$/m)
    assert(head, `${skill.slug}: CHANGELOG.md has no "## x.y.z" heading`)
    assert.strictEqual(head[1], readMeta(skill).version, `${skill.slug}: CHANGELOG head != frontmatter version`)
  }
})

test('every skill ships only .md files (keeps local installs and ClawHub bundles identical)', () => {
  const { filesOf } = require('../lib/install')
  for (const skill of realSkills) {
    for (const rel of filesOf(skill.dir)) {
      assert(rel.endsWith('.md'), `${skill.slug}: ${rel} is not a .md file`)
    }
  }
})

// --- slug resolution ---

test('resolveSlugs with no request returns every skill', () => {
  const { skills, unknown } = resolveSlugs([], listSkills(FIXTURE_SKILLS))
  assert.deepStrictEqual(skills.map(s => s.slug), ['alpha', 'beta'])
  assert.deepStrictEqual(unknown, [])
})

test('resolveSlugs reports unknown slugs and dedupes repeats', () => {
  const all = listSkills(FIXTURE_SKILLS)
  const { skills, unknown } = resolveSlugs(['beta', 'beta', 'nope'], all)
  assert.deepStrictEqual(skills.map(s => s.slug), ['beta'])
  assert.deepStrictEqual(unknown, ['nope'])
})

test('SKILL_FACTORY_SKILLS_DIR overrides the registry root', () => {
  const { skillsDir } = require('../lib/skills')
  const before = process.env.SKILL_FACTORY_SKILLS_DIR
  try {
    process.env.SKILL_FACTORY_SKILLS_DIR = FIXTURE_SKILLS
    assert.strictEqual(skillsDir(), FIXTURE_SKILLS)
    assert.deepStrictEqual(listSkills().map(s => s.slug), ['alpha', 'beta'])
  } finally {
    if (before === undefined) delete process.env.SKILL_FACTORY_SKILLS_DIR
    else process.env.SKILL_FACTORY_SKILLS_DIR = before
  }
})
