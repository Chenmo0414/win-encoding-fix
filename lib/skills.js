'use strict'

// The skill registry.
//
// There is no manifest file: the filesystem IS the registry, and a skill's
// DIRECTORY NAME is its slug. That is the same identity ClawHub uses
// (`clawhub install <slug>` writes to `<skills-dir>/<slug>`) and the same
// identity the install target uses on disk, so the three can never drift.
// A manifest would be a second source of truth that only a `validate` command
// could keep honest — and it would be a guaranteed merge-conflict line.
//
// Requiring this module has no side effects.

const fs = require('fs')
const path = require('path')

// SKILL_FACTORY_SKILLS_DIR lets the test suite point the registry at a
// deterministic fixture set, so count assertions don't change every time a real
// skill is added to the factory.
function skillsDir() {
  return process.env.SKILL_FACTORY_SKILLS_DIR || path.join(__dirname, '..', 'skills')
}

function listSkills(dir = skillsDir()) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    // Dot dirs are ClawHub/VCS bookkeeping; underscore is the conventional
    // "work in progress, don't ship me" prefix.
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue

    const skillDir = path.join(dir, entry.name)
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue

    // `skills/` is also ClawHub's default managed directory. If someone runs
    // `clawhub install <slug>` at the repo root, the installed skill lands here
    // carrying .clawhub/origin.json. Skipping those keeps a foreign skill from
    // being silently re-published or pushed into the user's ~/.claude by this
    // factory — it is not ours to ship.
    if (fs.existsSync(path.join(skillDir, '.clawhub', 'origin.json'))) continue

    found.push({ slug: entry.name, dir: skillDir })
  }

  // Byte-order sort, not localeCompare: CI runs on both ubuntu and windows and
  // the order feeds assertions, so it has to be locale-independent.
  return found.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

// Top-level scalars only. Nested keys (`metadata:` and its children) are
// DELIBERATELY not parsed: this CLI never reads them, and they pass through to
// ClawHub untouched. Keeping the parser flat is what lets it stay 12 lines.
function parseFrontmatter(text) {
  // Strip a leading UTF-8 BOM before anchoring on ^---. An authored SKILL.md
  // saved by a Windows editor may well carry one, and without this the whole
  // frontmatter silently parses as {} — which then surfaces as the baffling
  // `version "undefined" is not semver`. A repo about encoding should absorb
  // this rather than blame the author.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!block) return {}

  const out = {}
  for (const line of block[1].split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) continue // indented -> nested, skip
    const kv = line.match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    const q = value[0]
    if ((q === '"' || q === "'") && value.length >= 2 && value[value.length - 1] === q) {
      value = value.slice(1, -1)
    }
    out[kv[1]] = value
  }
  return out
}

function readMeta(skill) {
  return parseFrontmatter(fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf-8'))
}

// No slugs requested means "every skill" — that keeps bare `install` doing what
// it does today. A misspelled slug is reported, never silently skipped.
function resolveSlugs(requested, all = listSkills()) {
  if (!requested || requested.length === 0) return { skills: all, unknown: [] }

  const skills = []
  const unknown = []
  for (const slug of requested) {
    const hit = all.find(s => s.slug === slug)
    if (!hit) unknown.push(slug)
    else if (!skills.includes(hit)) skills.push(hit)
  }
  return { skills, unknown }
}

module.exports = { skillsDir, listSkills, parseFrontmatter, readMeta, resolveSlugs }
