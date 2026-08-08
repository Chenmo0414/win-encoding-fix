#!/usr/bin/env node

// Thin entry point. Keep this path — README and the test suite both spawn it.
const { run } = require('../lib/cli')

process.exitCode = run(process.argv.slice(2))
