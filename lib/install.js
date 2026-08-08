'use strict'

// Copy / remove one skill under one assistant's skills root.
//
// These functions never print: they return a status and a message so the CLI
// owns every byte of stdout in one place (lib/cli.js). The exact wording of
// those messages is a tested contract — see test/install.test.js.
//
// The `files` list is supplied by the caller rather than globbed here, so
// install and uninstall provably operate on the SAME file set.

const fs = require('fs')
const path = require('path')

// Every file that belongs to a skill, as paths relative to its directory.
// Dot entries and node_modules are skipped, which is exactly what ClawHub's
// bundler skips too — so a locally installed skill and a published one contain
// the same files by construction.
function filesOf(skillDir) {
  const out = []

  function walk(rel) {
    const abs = rel ? path.join(skillDir, rel) : skillDir
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const childRel = rel ? path.join(rel, entry.name) : entry.name
      if (entry.isDirectory()) walk(childRel)
      else if (entry.isFile()) out.push(childRel)
    }
  }

  walk('')
  return out.sort()
}

// Hand-rolled instead of fs.cpSync: that is node 16.7+, above the engines floor.
function copyTree(fromDir, toDir, files) {
  for (const rel of files) {
    const dest = path.join(toDir, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(fromDir, rel), dest)
  }
}

function installSkill(opts) {
  const { slug, sourceDir, files, skillsRoot } = opts

  if (!skillsRoot) return { status: 'skip', message: 'not detected' }

  const dest = path.join(skillsRoot, slug)
  try {
    copyTree(sourceDir, dest, files)
    return { status: 'ok', dest, message: dest }
  } catch (err) {
    return { status: 'fail', dest, message: err.message }
  }
}

function uninstallSkill(opts) {
  const { slug, files, skillsRoot } = opts

  if (!skillsRoot) return { status: 'skip', message: 'not installed' }

  const dest = path.join(skillsRoot, slug)
  let removed = 0
  for (const rel of files) {
    const file = path.join(dest, rel)
    if (!fs.existsSync(file)) continue
    fs.unlinkSync(file)
    removed++
  }
  if (removed === 0) return { status: 'skip', message: 'not installed' }

  // rmdirSync only removes an empty dir; keep the message honest about whether
  // the directory is actually gone (it may still hold unrelated files).
  let dirGone = false
  try {
    fs.rmdirSync(dest)
    dirGone = true
  } catch {}

  return {
    status: 'ok',
    dest,
    message: dirGone
      ? 'removed'
      : 'files removed (directory kept — still contains other files)'
  }
}

module.exports = { filesOf, copyTree, installSkill, uninstallSkill }
