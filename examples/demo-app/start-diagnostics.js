// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * Startup diagnostics for `node esbuild.config.mjs --start`.
 *
 * The dev server used to fail in ways that left no trace: a missing
 * `node_modules/.bin/tailwindcss` (a half-finished install) or a missing
 * `xdg-open` (a headless container) both surface as an asynchronous `error`
 * event on a `spawn()` call. With no `error` listener that event becomes an
 * uncaught exception, so the process died — often *after* the "running at
 * http://localhost:8080" line — and whoever opened the preview saw nothing but
 * `Not Found`.
 *
 * This module is deliberately CommonJS and free of side effects so both the
 * ESM esbuild config and the test suite can use it.
 */

const fs = require('fs');
const path = require('path');

/** Referenced exactly as the `--start` path spawns it (cwd-relative). */
const TAILWIND_BIN = './node_modules/.bin/tailwindcss';

/**
 * Inputs `--start` cannot run without. Paths are written the way the start
 * path references them, so the failure message names something a developer can
 * check verbatim.
 */
const REQUIRED_START_INPUTS = [
  {
    path: TAILWIND_BIN,
    role: 'Tailwind CSS watcher',
    remedy: 'run `yarn` in examples/demo-app'
  },
  {
    path: 'dist/index.html',
    role: 'served document and SPA fallback',
    remedy: 'restore examples/demo-app/dist/index.html'
  },
  {
    path: 'src/main.js',
    role: 'esbuild entry point',
    remedy: 'restore examples/demo-app/src/main.js'
  }
];

/**
 * @param {string} baseDir directory the start command runs in
 * @param {Array<{path: string, role: string, remedy: string}>} [inputs]
 * @returns {Array} the entries of `inputs` that are not present under `baseDir`
 */
function findMissingStartInputs(baseDir, inputs = REQUIRED_START_INPUTS) {
  return inputs.filter(input => !fs.existsSync(path.resolve(baseDir, input.path)));
}

/**
 * A `cli-diagnostic-block`: headline, aligned fields, then the missing paths.
 * Mirrors the block `scripts/install-and-start.js` prints, so a failure looks
 * the same wherever the startup chain breaks.
 *
 * @returns {string} message to print on stderr before exiting non-zero
 */
function formatMissingStartInputs(missing, baseDir, command) {
  const lines = [
    '',
    `✖ demo-app --start failed: ${missing.length} required input(s) missing`,
    `  folder : ${baseDir}`,
    `  command: ${command}`,
    '  missing:'
  ];

  missing.forEach(input => {
    lines.push(`  - ${input.path} — ${input.role}`);
    lines.push(`    expected at ${path.resolve(baseDir, input.path)}`);
    lines.push(`    fix: ${input.remedy}`);
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * One line naming the executable that could not be started and why.
 * `ENOENT` is by far the common case and "not found on this system" says more
 * than node's own `spawn xdg-open ENOENT`.
 */
function describeSpawnFailure(command, error, {fatal = true} = {}) {
  const reason =
    error && error.code === 'ENOENT'
      ? 'not found on this system'
      : `could not be started (${(error && error.message) || 'unknown error'})`;

  return fatal
    ? `✖ demo-app --start failed: "${command}" ${reason}`
    : `⚠️  "${command}" ${reason} — continuing without it`;
}

/**
 * Turn a child process's asynchronous `error` event — the ENOENT node emits
 * when an executable cannot be spawned — into a printed, named diagnosis.
 * Without an `error` listener that event is an uncaught exception and takes
 * the whole dev server down.
 *
 * @param {import('child_process').ChildProcess} child
 * @param {{command: string, fatal?: boolean, log?: Function, onFailure?: Function}} options
 *   `fatal: false` marks an optional helper (opening a browser): it is logged
 *   as a warning and the server keeps running.
 * @returns {import('child_process').ChildProcess} the same child, for chaining
 */
function attachSpawnDiagnostics(child, {command, fatal = true, log, onFailure}) {
  const write = log || (fatal ? console.error : console.warn);

  child.on('error', error => {
    write(describeSpawnFailure(command, error, {fatal}));
    if (fatal && onFailure) {
      onFailure(error);
    }
  });

  return child;
}

module.exports = {
  REQUIRED_START_INPUTS,
  TAILWIND_BIN,
  attachSpawnDiagnostics,
  describeSpawnFailure,
  findMissingStartInputs,
  formatMissingStartInputs
};
