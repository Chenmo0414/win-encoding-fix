'use strict'

// Where installed skills live on disk, per assistant. Slug-agnostic: this module
// only knows about *skills roots*; which skill goes into one is the caller's job.
//
// Requiring this module has no side effects — nothing is read, printed or
// scanned until a function is called. That matters: resolving targets scans
// drive roots, so `--help` must be able to load the CLI without triggering it.

const fs = require('fs')
const os = require('os')
const path = require('path')

// Build the ordered list of install targets. OpenClaw may resolve to MORE THAN
// ONE root (e.g. installs on multiple drives), so targets is a flat list rather
// than a name->path map — otherwise multi-drive installs would silently only
// ever touch the first root found.
function resolveTargets(opts = {}) {
  const {
    claude = null,
    codex = null,
    openclaw = null,
    env = process.env,
    home = os.homedir()
  } = opts

  const targets = [
    { name: 'claude', skillsRoot: path.join(claude || path.join(home, '.claude'), 'skills') },
    { name: 'codex', skillsRoot: path.join(codex || path.join(home, '.codex'), 'skills') }
  ]

  if (openclaw) {
    targets.push({ name: 'openclaw', skillsRoot: path.join(openclaw, 'workspace', 'skills') })
  } else {
    const roots = detectOpenclawSkillsRoots({ env, home })
    if (roots.length === 0) {
      targets.push({ name: 'openclaw', skillsRoot: null })
    } else {
      for (const root of roots) targets.push({ name: 'openclaw', skillsRoot: root })
    }
  }

  return targets
}

// Return EVERY existing OpenClaw skills root (deduped by real path), not just
// the first — so install/uninstall reach all of them.
function detectOpenclawSkillsRoots(opts = {}) {
  const { env = process.env, home = os.homedir() } = opts

  const candidates = [
    env.OPENCLAW_HOME && path.join(env.OPENCLAW_HOME, 'workspace', 'skills'),
    path.join(home, '.openclaw', 'workspace', 'skills')
  ].filter(Boolean)

  // The drive scan reaches real installs regardless of HOME, so tests disable it
  // to stay hermetic. WIN_ENCODING_FIX_NO_DRIVE_SCAN is the legacy spelling and
  // stays honoured forever: if it ever stopped gating, "sealed" tests would
  // silently start scanning the machine's real drives again.
  if (!env.SKILL_FACTORY_NO_DRIVE_SCAN && !env.WIN_ENCODING_FIX_NO_DRIVE_SCAN) {
    for (const drive of ['C', 'D', 'E', 'F']) {
      candidates.push(path.join(`${drive}:`, '.openclaw', 'workspace', 'skills'))
    }
  }

  const found = []
  const seen = new Set()
  for (const skillsDir of candidates) {
    let exists = false
    try { exists = fs.existsSync(skillsDir) } catch { exists = false }
    if (!exists) continue
    // Dedupe roots that resolve to the same physical location (junctions, etc.).
    let key = skillsDir
    try { key = fs.realpathSync(skillsDir) } catch {}
    if (seen.has(key)) continue
    seen.add(key)
    found.push(skillsDir)
  }
  return found
}

module.exports = { resolveTargets, detectOpenclawSkillsRoots }
