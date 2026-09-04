#!/usr/bin/env node

// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * Verifies that every root toolchain declaration pins the same Node and Yarn version.
 *
 * The repository pins its toolchain in four places, each read by a different tool:
 *
 * | Declaration                    | Read by          |
 * | ------------------------------ | ---------------- |
 * | `.tool-versions`               | asdf, mise       |
 * | `.nvmrc`                       | nvm, fnm         |
 * | `package.json` `volta`         | Volta, CI        |
 * | `package.json` `packageManager`| Corepack, Yarn   |
 *
 * When they drift apart a contributor's shell silently picks a different Node than CI,
 * which is how prebuilt native modules fall back to slow (and often failing) source builds.
 *
 * `compareToolVersions` is pure: it takes the already-read declarations and returns a
 * report. The CLI below is the only part that touches the filesystem or exits.
 */
const fs = require('fs');
const path = require('path');

/**
 * Files inspected by the CLI, relative to the repository root.
 */
const TOOL_VERSION_FILES = {
  toolVersions: '.tool-versions',
  nvmrc: '.nvmrc',
  packageJson: 'package.json'
};

/**
 * @typedef {Object} ToolVersionDeclarations
 * @property {?string} toolVersions Raw `.tool-versions` contents, or null when absent.
 * @property {?string} nvmrc Raw `.nvmrc` contents, or null when absent.
 * @property {?{node?: string, yarn?: string}} volta The root `package.json` `volta` block.
 * @property {?string} packageManager The root `package.json` `packageManager` field.
 */

/**
 * @typedef {Object} VersionReading
 * @property {?string} version The declared version, or null when it could not be read.
 * @property {?string} note Why the version could not be read, when it could not be.
 */

/**
 * @typedef {Object} ToolVersionProblem
 * @property {string} tool The tool the problem is about, e.g. `node`.
 * @property {'missing'|'mismatch'} kind Whether a declaration is absent or disagrees.
 * @property {string} message Human readable, single-line summary.
 * @property {{source: string, version: ?string, note: ?string}[]} sources The readings compared.
 */

/**
 * Strips a leading `v` and surrounding whitespace from a version declaration.
 *
 * @param {*} value
 * @returns {?string} The normalized version, or null when there is nothing to normalize.
 */
function normalizeVersion(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/^v/, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * Reads one tool's version out of `.tool-versions`.
 *
 * The format is one `<tool> <version>...` entry per line; `#` starts a comment. asdf and
 * mise resolve fallback versions left to right, so the first version wins.
 *
 * @param {?string} contents Raw file contents, or null when the file is absent.
 * @param {string} tool The tool name as spelled in the file, e.g. `nodejs`.
 * @returns {VersionReading}
 */
function readFromToolVersions(contents, tool) {
  if (typeof contents !== 'string') {
    return {version: null, note: `${TOOL_VERSION_FILES.toolVersions} not found`};
  }
  const entry = contents
    .split('\n')
    .map(line => line.replace(/#.*$/, '').trim().split(/\s+/))
    .find(fields => fields[0] === tool);

  if (!entry) {
    return {version: null, note: `no \`${tool}\` entry`};
  }
  const version = normalizeVersion(entry[1]);
  return {version, note: version ? null : `\`${tool}\` entry has no version`};
}

/**
 * Reads the version out of a `packageManager` field, e.g. `yarn@4.4.0+sha224.abc`.
 *
 * @param {?string} value The raw field value.
 * @param {string} expectedName The package manager the version is expected to belong to.
 * @returns {VersionReading}
 */
function readFromPackageManager(value, expectedName) {
  const declaration = typeof value === 'string' ? value.trim() : '';
  if (declaration === '') {
    return {version: null, note: 'not declared'};
  }
  // Corepack allows an optional `+<integrity hash>` suffix that is not part of the version.
  const match = /^(.+?)@([^+]+)/.exec(declaration);
  if (!match) {
    return {version: null, note: `\`${declaration}\` is not \`<name>@<version>\``};
  }
  if (match[1] !== expectedName) {
    return {version: null, note: `declares \`${match[1]}\`, expected \`${expectedName}\``};
  }
  return {version: normalizeVersion(match[2]), note: null};
}

/**
 * Every declaration compared, grouped by the tool it pins.
 *
 * Each source names the exact place a reader should edit to fix a mismatch.
 */
const COMPARED_SOURCES = {
  node: [
    {
      source: `${TOOL_VERSION_FILES.toolVersions} (nodejs)`,
      read: declarations => readFromToolVersions(declarations.toolVersions, 'nodejs')
    },
    {
      source: TOOL_VERSION_FILES.nvmrc,
      read: declarations =>
        typeof declarations.nvmrc === 'string'
          ? {version: normalizeVersion(declarations.nvmrc), note: null}
          : {version: null, note: `${TOOL_VERSION_FILES.nvmrc} not found`}
    },
    {
      source: `${TOOL_VERSION_FILES.packageJson} volta.node`,
      read: declarations => ({
        version: normalizeVersion(declarations.volta && declarations.volta.node),
        note: null
      })
    }
  ],
  yarn: [
    {
      source: `${TOOL_VERSION_FILES.toolVersions} (yarn)`,
      read: declarations => readFromToolVersions(declarations.toolVersions, 'yarn')
    },
    {
      source: `${TOOL_VERSION_FILES.packageJson} volta.yarn`,
      read: declarations => ({
        version: normalizeVersion(declarations.volta && declarations.volta.yarn),
        note: null
      })
    },
    {
      source: `${TOOL_VERSION_FILES.packageJson} packageManager`,
      read: declarations => readFromPackageManager(declarations.packageManager, 'yarn')
    }
  ]
};

/**
 * Compares the root toolchain declarations against each other.
 *
 * Pure: no filesystem access, no process exit, no logging.
 *
 * @param {ToolVersionDeclarations} declarations
 * @returns {{ok: boolean, problems: ToolVersionProblem[], versions: Object, readings: Object}}
 *   `versions` maps each tool to the agreed version, or null when there is no agreement.
 *   `readings` maps each tool to `{[source]: version}` so callers can report what was found.
 */
function compareToolVersions(declarations) {
  const input = declarations || {};
  const problems = [];
  const versions = {};
  const readings = {};

  Object.keys(COMPARED_SOURCES).forEach(tool => {
    const found = COMPARED_SOURCES[tool].map(({source, read}) => {
      const reading = read(input);
      return {source, version: reading.version, note: reading.note || null};
    });

    readings[tool] = found.reduce((acc, {source, version}) => ({...acc, [source]: version}), {});

    const missing = found.filter(({version}) => version === null);
    if (missing.length) {
      problems.push({
        tool,
        kind: 'missing',
        message: `${tool} version is not declared in ${missing
          .map(({source}) => source)
          .join(', ')}`,
        sources: found
      });
    }

    const distinct = [...new Set(found.map(({version}) => version).filter(v => v !== null))];
    versions[tool] = distinct.length === 1 ? distinct[0] : null;

    if (distinct.length > 1) {
      problems.push({
        tool,
        kind: 'mismatch',
        message: `${tool} version differs across declarations: ${distinct.join(', ')}`,
        sources: found
      });
    }
  });

  return {ok: problems.length === 0, problems, versions, readings};
}

/**
 * Renders a report as the multi-line text the CLI prints.
 *
 * @param {{ok: boolean, problems: ToolVersionProblem[], versions: Object}} report
 * @returns {string}
 */
function formatReport(report) {
  if (report.ok) {
    const summary = Object.keys(report.versions)
      .map(tool => `${tool} ${report.versions[tool]}`)
      .join(', ');
    return `Tool versions are consistent (${summary}).`;
  }

  return report.problems
    .map(problem => {
      const rows = problem.sources.map(({source, version, note}) => {
        const value = version === null ? `(missing${note ? ` — ${note}` : ''})` : version;
        return `    ${source.padEnd(34)} ${value}`;
      });
      return [problem.message, ...rows].join('\n');
    })
    .join('\n\n');
}

/**
 * Reads the toolchain declarations from disk.
 *
 * @param {string} rootDir The repository root.
 * @returns {ToolVersionDeclarations}
 */
function readDeclarations(rootDir) {
  const readIfExists = file => {
    const filePath = path.join(rootDir, file);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  };
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, TOOL_VERSION_FILES.packageJson), 'utf8')
  );

  return {
    toolVersions: readIfExists(TOOL_VERSION_FILES.toolVersions),
    nvmrc: readIfExists(TOOL_VERSION_FILES.nvmrc),
    volta: packageJson.volta,
    packageManager: packageJson.packageManager
  };
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const report = compareToolVersions(readDeclarations(rootDir));

  if (!report.ok) {
    console.error(
      `Toolchain version declarations disagree. Update them so every source below matches.\n`
    );
    console.error(formatReport(report));
    console.error('');
    process.exit(1);
  }

  console.log(formatReport(report));
}

module.exports = {
  TOOL_VERSION_FILES,
  compareToolVersions,
  formatReport,
  readDeclarations
};

if (require.main === module) {
  main();
}
