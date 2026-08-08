'use strict'

// Packaging and release integrity — the failures that stay invisible when you
// only ever run the CLI from a git checkout.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const { test, ROOT } = require('./harness')

console.log('--- release ---')

const pkg = require('../package.json')

// package.json "files" is a root-relative allowlist. Omitting "lib/" or
// "skills/" produces a published package whose CLI dies with MODULE_NOT_FOUND or
// installs nothing — while `npm test` from the repo stays green, because the
// repo has the files either way. This is the single most likely silent failure
// of the whole restructure.
// Run npm without going through a .cmd shim: node 20.12+/22+/24 refuse to
// spawn .cmd/.bat directly (CVE-2024-27980), and `shell: true` would hand the
// command line to cmd.exe — the very path this repo's rule 3 forbids. npm ships
// as plain JS next to the node binary, so invoke that with process.execPath.
function runNpm(args) {
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ]
  const cli = candidates.find(p => fs.existsSync(p))
  assert(cli, `could not locate npm-cli.js next to ${process.execPath}`)
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

test('npm pack ships bin/, lib/ and the skills, and does not ship test/ or scripts/', () => {
  const raw = runNpm(['pack', '--dry-run', '--json'])

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`could not parse \`npm pack --json\` output: ${err.message}\n${raw.slice(0, 400)}`)
  }

  const entry = Array.isArray(parsed) ? parsed[0] : parsed
  const shipped = (entry.files || []).map(f => f.path.replace(/\\/g, '/'))
  assert(shipped.length > 0, 'npm pack reported no files')

  for (const required of [
    'bin/cli.js',
    'lib/cli.js',
    'lib/skills.js',
    'lib/targets.js',
    'lib/install.js',
    'lib/setup-env.js',
    'skills/windows-shell/SKILL.md',
    'README.md',
    'LICENSE'
  ]) {
    assert(shipped.includes(required), `tarball is missing ${required}\nshipped: ${shipped.join(', ')}`)
  }

  for (const forbidden of shipped) {
    assert(!forbidden.startsWith('test/'), `tarball ships a test file: ${forbidden}`)
    assert(!forbidden.startsWith('scripts/'), `tarball ships a script: ${forbidden}`)
  }
})

test('every bin map target exists and is an executable node entry point', () => {
  const entries = Object.entries(pkg.bin)
  assert(entries.length > 0, 'no bin entries')
  // The legacy name must keep resolving: the only way anyone installed this was
  // `npm i -g` from a clone, and npm 7+ refuses to relink a bin owned by a
  // different package name.
  assert(Object.keys(pkg.bin).includes('win-encoding-fix'), 'the legacy bin name was dropped')
  for (const [name, rel] of entries) {
    const abs = path.join(ROOT, rel)
    assert(fs.existsSync(abs), `bin ${name} -> ${rel} does not exist`)
    const first = fs.readFileSync(abs, 'utf-8').split('\n')[0]
    assert.strictEqual(first, '#!/usr/bin/env node', `bin ${name} has shebang: ${first}`)
  }
})

test('there is no .clawhubignore at the repo root', () => {
  // The publish unit is skills/<slug>/, so an ignore file at the root would only
  // ever be misleading.
  assert(!fs.existsSync(path.join(ROOT, '.clawhubignore')), '.clawhubignore is back')
})

test('publish script takes a slug, reads CHANGELOG.md, and hardcodes no version', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'publish-clawhub.sh'), 'utf-8')
  assert(/SLUG="\$\{1:-\}"/.test(script), 'the slug is not taken from $1')
  assert(script.includes('CHANGELOG.md'), 'the changelog is not read from CHANGELOG.md')
  assert(script.includes('--dry-run'), 'no dry-run path')
  // A baked-in changelog silently ships the previous release's notes under the
  // new version number, which is exactly the bug this replaced.
  const semver = script.match(/\b\d+\.\d+\.\d+\b/)
  assert(!semver, `publish script contains a hardcoded version: ${semver && semver[0]}`)
})

// A repo whose subject matter is Windows encoding has to hold for itself.
test('every tracked file is valid UTF-8, BOM-free, CR-free and ends with a newline', () => {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf-8' })
  const files = listed.split('\0').filter(Boolean)
  assert(files.length > 0, 'git ls-files returned nothing')

  const problems = []
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(ROOT, rel))
    if (buf.length === 0) continue
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) problems.push(`${rel}: UTF-8 BOM`)
    if (buf.includes(0x0d)) problems.push(`${rel}: contains CR`)
    if (buf[buf.length - 1] !== 0x0a) problems.push(`${rel}: no trailing newline`)
    if (Buffer.compare(Buffer.from(buf.toString('utf-8'), 'utf-8'), buf) !== 0) {
      problems.push(`${rel}: not valid UTF-8`)
    }
  }
  assert.strictEqual(problems.length, 0, `\n  ${problems.join('\n  ')}`)
})

// Static check instead of a node 14 CI leg: node 14 is EOL and setup-node
// resolving it on windows-latest is itself a flake source, while the floor
// actually forbids only a handful of APIs.
test('lib/ and bin/ use no API above the engines floor', () => {
  const floor = pkg.engines.node
  const forbidden = [
    [/\bfs\.cpSync\b/, 'fs.cpSync is node 16.7+'],
    [/require\('node:/, "require('node:...') is node 14.18+/16+"],
    [/\brequire\('node:test'\)/, 'node:test is node 18+'],
    [/\bstructuredClone\b/, 'structuredClone is node 17+'],
    [/\bArray\.prototype\.at\b|\.at\(-/, 'Array.prototype.at is node 16.6+'],
    [/\bObject\.hasOwn\b/, 'Object.hasOwn is node 16.9+']
  ]

  // Comments are stripped first: these modules deliberately DOCUMENT the APIs
  // they avoid ("hand-rolled instead of fs.cpSync, that is node 16.7+"), and a
  // check that flagged its own rationale would be self-defeating.
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const problems = []
  for (const dir of ['lib', 'bin']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (!name.endsWith('.js')) continue
      const src = stripComments(fs.readFileSync(path.join(ROOT, dir, name), 'utf-8'))
      for (const [pattern, why] of forbidden) {
        if (pattern.test(src)) problems.push(`${dir}/${name}: ${why} (engines says ${floor})`)
      }
    }
  }
  assert.strictEqual(problems.length, 0, `\n  ${problems.join('\n  ')}`)
})

test('package identity is the renamed factory, with the two version axes separate', () => {
  assert.strictEqual(pkg.name, 'skill-factory')
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), `factory version ${pkg.version} is not semver`)
  const { listSkills, readMeta } = require('../lib/skills')
  // The factory version and a skill's version are independent on purpose; this
  // asserts nothing about their relationship other than that both exist.
  for (const skill of listSkills()) {
    assert(/^\d+\.\d+\.\d+$/.test(readMeta(skill).version || ''), `${skill.slug}: bad version`)
  }
})
