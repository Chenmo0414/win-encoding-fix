#!/usr/bin/env node
'use strict'

/**
 * Suite entry point:  npm test  ->  node test/run.js
 *
 * Requires each test file in a fixed order and asserts that each one actually
 * registered cases. That second check is the point: the harness keeps a shared
 * counter, so a file that throws while being required would otherwise drop its
 * cases out of the tally and leave the suite reporting all-green.
 */

const { total, fail, summary } = require('./harness')

const FILES = [
  './cli.test.js',
  './skills.test.js',
  './targets.test.js',
  './install.test.js',
  './setup-env.test.js',
  './release.test.js',
  './skills/windows-shell.test.js'
]

console.log('\nskill-factory test suite\n')

for (const file of FILES) {
  const before = total()
  try {
    require(file)
  } catch (err) {
    fail(`${file} (load)`, `threw while being required: ${err.stack || err.message}`)
    continue
  }
  if (total() === before) {
    fail(`${file} (load)`, 'registered no test cases — did an early return or a bad require silence it?')
  }
}

process.exit(summary())
