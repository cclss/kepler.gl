#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * Launcher behind the root `start:*` scripts:
 *
 *   node ./scripts/install-and-start <folder> <script>
 *
 * It used to decide "is this example installed?" by testing for the existence
 * of `<folder>/node_modules`. That directory appears as soon as an install
 * *starts*, so a half-finished install looked complete: the launcher skipped
 * the install and ran the start script against a tree with no `.bin` entries.
 * The dev server then died on a missing executable and the preview served
 * nothing but `Not Found`, with no visible cause.
 *
 * Instead we check what the start script actually needs — the declared
 * dependencies and the `node_modules/.bin/*` executables referenced by the
 * script command and its local entry file — reinstall when anything is
 * missing, and report the folder, the exact command and the child exit code
 * on any failure.
 */

const {existsSync, readFileSync, statSync} = require('fs');
const {spawnSync} = require('child_process');
const {join} = require('path');

/** `node_modules/.bin/<name>` references, with or without a leading `./`. */
const BIN_REFERENCE = /(?:\.\/)?node_modules\/\.bin\/([\w.-]+)/g;

/** Files a script command hands to node, e.g. `node esbuild.config.mjs`. */
const SCRIPT_FILE = /\.(?:js|mjs|cjs)$/;

const PACKAGE_MANAGER = 'yarn';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readFileIfExists(path) {
  try {
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  } catch (err) {
    return null;
  }
}

function findBinReferences(content) {
  const found = [];
  if (!content) {
    return found;
  }
  // A fresh regex per call: BIN_REFERENCE is global and carries lastIndex.
  const pattern = new RegExp(BIN_REFERENCE.source, 'g');
  let match = pattern.exec(content);
  while (match) {
    found.push(match[1]);
    match = pattern.exec(content);
  }
  return found;
}

/**
 * Executables the start script needs from `<folder>/node_modules/.bin`.
 *
 * Two sources, one hop deep — enough to cover the demo app (whose
 * `start:local` runs `node esbuild.config.mjs`, and that config spawns
 * `./node_modules/.bin/tailwindcss`) without walking the whole module graph:
 *
 *   1. `node_modules/.bin/<name>` written directly in the script command.
 *   2. the same references inside local `.js`/`.mjs`/`.cjs` files the command
 *      passes to node.
 */
function collectRequiredBins(folder, command) {
  const bins = new Set(findBinReferences(command));

  String(command || '')
    .split(/\s+/)
    .filter(token => SCRIPT_FILE.test(token))
    .forEach(token => {
      findBinReferences(readFileIfExists(join(folder, token))).forEach(bin => bins.add(bin));
    });

  return [...bins];
}

/**
 * What is missing from `<folder>/node_modules`. An empty list means the folder
 * is installed well enough to run the requested script.
 *
 * Every entry is a reason to install. Only `critical` entries — a missing
 * module tree or a missing executable the start script will invoke — are a
 * reason to give up after a *successful* install: a package manager is free to
 * satisfy a declared dependency from a parent `node_modules`, so a dependency
 * that is still not in this folder after a clean install is worth reporting
 * but not worth refusing to start over.
 */
function findMissingInstallParts(folder, pkg, requiredBins) {
  const nodeModules = join(folder, 'node_modules');

  if (!existsSync(nodeModules)) {
    return [{critical: true, label: `${nodeModules} (never installed)`}];
  }

  const declaredDeps = [
    ...Object.keys((pkg && pkg.dependencies) || {}),
    ...Object.keys((pkg && pkg.devDependencies) || {})
  ];

  const missingDeps = declaredDeps
    .filter(dep => !existsSync(join(nodeModules, dep)))
    .map(dep => ({critical: false, label: `dependency "${dep}"`}));

  const missingBins = requiredBins
    .filter(bin => !existsSync(join(nodeModules, '.bin', bin)))
    .map(bin => ({critical: true, label: `executable "node_modules/.bin/${bin}"`}));

  return missingDeps.concat(missingBins);
}

const MAX_LISTED = 8;

function describe(parts) {
  const labels = parts.map(part => (typeof part === 'string' ? part : part.label));
  const shown = labels.slice(0, MAX_LISTED).map(label => `  - ${label}`);
  if (labels.length > MAX_LISTED) {
    shown.push(`  - ... and ${labels.length - MAX_LISTED} more`);
  }
  return shown.join('\n');
}

function fail({folder, command, code, reason, detail}) {
  const parts = [
    '',
    `✖ install-and-start failed: ${reason}`,
    `  folder : ${folder}`,
    command ? `  command: ${command}` : null,
    typeof code === 'number' ? `  exit   : ${code}` : null,
    detail ? `${detail}` : null,
    ''
  ].filter(Boolean);

  console.error(parts.join('\n'));
  return typeof code === 'number' && code !== 0 ? code : 1;
}

/**
 * Run `yarn <args>` in `folder` with inherited stdio.
 * Returns `{code, command}` — `code` is non-zero for a failed or killed child,
 * including the case where yarn itself cannot be executed.
 */
function runYarn(folder, args) {
  const command = `${PACKAGE_MANAGER} ${args.join(' ')}`;
  const result = spawnSync(PACKAGE_MANAGER, args, {cwd: folder, stdio: 'inherit'});

  if (result.error) {
    return {
      command,
      code: 1,
      error:
        result.error.code === 'ENOENT'
          ? `"${PACKAGE_MANAGER}" is not on PATH`
          : `${PACKAGE_MANAGER} could not be started: ${result.error.message}`
    };
  }
  if (result.signal) {
    return {command, code: 1, error: `killed by signal ${result.signal}`};
  }
  return {command, code: result.status === null ? 1 : result.status};
}

/** @returns {number} process exit code. */
function main(argv) {
  const [folder, script] = argv;

  if (!folder || !script) {
    console.error('Usage: node ./scripts/install-and-start <folder> <script>');
    return 1;
  }

  const pkg = readJson(join(folder, 'package.json'));
  if (!pkg) {
    return fail({
      folder,
      reason: `no readable package.json in "${folder}"`
    });
  }

  const scripts = pkg.scripts || {};
  const requiredBins = collectRequiredBins(folder, scripts[script]);

  let missing = findMissingInstallParts(folder, pkg, requiredBins);

  if (missing.length) {
    console.info(
      `\n${folder} is not fully installed, running "${PACKAGE_MANAGER} install":\n${describe(
        missing
      )}\n`
    );

    const install = runYarn(folder, ['install']);
    if (install.code !== 0) {
      return fail({
        folder,
        command: install.command,
        code: install.code,
        reason: install.error || 'install did not complete'
      });
    }

    missing = findMissingInstallParts(folder, pkg, requiredBins);
    const blocking = missing.filter(part => part.critical);

    if (blocking.length) {
      return fail({
        folder,
        command: install.command,
        code: 1,
        reason: `"${PACKAGE_MANAGER} install" succeeded but ${folder} is still incomplete`,
        detail: `  missing:\n${describe(blocking)}`
      });
    }
    if (missing.length) {
      console.warn(
        `\nStarting anyway — these are declared by ${folder}/package.json but were not ` +
          `materialized in its node_modules:\n${describe(missing)}\n`
      );
    }
  }

  if (!scripts[script] && !existsSync(join(folder, 'node_modules', '.bin', script))) {
    return fail({
      folder,
      reason: `"${script}" is neither a script in ${folder}/package.json nor an installed executable`,
      detail: `  available scripts:\n${describe(Object.keys(scripts))}`
    });
  }

  const run = runYarn(folder, [script]);
  if (run.code !== 0) {
    return fail({
      folder,
      command: run.command,
      code: run.code,
      reason: run.error || `"${PACKAGE_MANAGER} ${script}" exited with a failure`
    });
  }

  return 0;
}

module.exports = {collectRequiredBins, findMissingInstallParts, main};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
