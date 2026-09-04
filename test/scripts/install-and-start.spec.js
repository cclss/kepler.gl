// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

const {spawnSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {collectRequiredBins, findMissingInstallParts} = require('../../scripts/install-and-start');

const LAUNCHER = path.resolve(__dirname, '../../scripts/install-and-start.js');

/**
 * A stand-in for `yarn` on PATH, so these tests never touch the network.
 * `mode` drives what the fake install and the fake script run do.
 */
const FAKE_YARN = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YARN_LOG, args.join(' ') + '\\n');

if (args[0] === 'install') {
  if (process.env.FAKE_YARN_MODE === 'install-fails') {
    process.exit(7);
  }
  if (process.env.FAKE_YARN_MODE === 'install-bins-only') {
    fs.mkdirSync(path.join(process.cwd(), 'node_modules', '.bin'), {recursive: true});
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'tailwindcss'), '');
  }
  if (process.env.FAKE_YARN_MODE === 'install-completes') {
    fs.mkdirSync(path.join(process.cwd(), 'node_modules', '.bin'), {recursive: true});
    fs.mkdirSync(path.join(process.cwd(), 'node_modules', 'fake-dep'), {recursive: true});
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', '.bin', 'tailwindcss'), '');
  }
  process.exit(0);
}

if (process.env.FAKE_YARN_MODE === 'run-fails') {
  process.exit(3);
}
process.stdout.write('STARTED ' + args.join(' ') + '\\n');
process.exit(0);
`;

let workdir;

function makeExample({installed}) {
  const folder = fs.mkdtempSync(path.join(workdir, 'example-'));

  fs.writeFileSync(
    path.join(folder, 'package.json'),
    JSON.stringify({
      name: 'fake-example',
      scripts: {'start:local': 'NODE_ENV=local node esbuild.config.mjs --start'},
      dependencies: {'fake-dep': '1.0.0'}
    })
  );
  fs.writeFileSync(
    path.join(folder, 'esbuild.config.mjs'),
    "spawn('./node_modules/.bin/tailwindcss', ['--watch']);"
  );

  // "half installed": node_modules exists (an install started) but the
  // dependency and the executable the start script needs are not there.
  fs.mkdirSync(path.join(folder, 'node_modules'), {recursive: true});

  if (installed) {
    fs.mkdirSync(path.join(folder, 'node_modules', '.bin'), {recursive: true});
    fs.mkdirSync(path.join(folder, 'node_modules', 'fake-dep'), {recursive: true});
    fs.writeFileSync(path.join(folder, 'node_modules', '.bin', 'tailwindcss'), '');
  }

  return folder;
}

function runLauncher(folder, script, mode) {
  const binDir = fs.mkdtempSync(path.join(workdir, 'bin-'));
  const yarnPath = path.join(binDir, 'yarn');
  fs.writeFileSync(yarnPath, FAKE_YARN, {mode: 0o755});

  const log = path.join(binDir, 'yarn.log');
  fs.writeFileSync(log, '');

  const result = spawnSync(process.execPath, [LAUNCHER, folder, script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      FAKE_YARN_LOG: log,
      FAKE_YARN_MODE: mode
    }
  });

  return {
    code: result.status,
    output: `${result.stdout}${result.stderr}`,
    yarnCalls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
  };
}

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-and-start-'));
});

afterEach(() => {
  fs.rmSync(workdir, {recursive: true, force: true});
});

describe('collectRequiredBins', () => {
  it('collects bins referenced by the script command itself', () => {
    const folder = makeExample({installed: true});
    expect(collectRequiredBins(folder, './node_modules/.bin/serve dist')).toEqual(['serve']);
  });

  it('collects bins referenced by the local entry file the script runs', () => {
    const folder = makeExample({installed: true});
    expect(collectRequiredBins(folder, 'NODE_ENV=local node esbuild.config.mjs --start')).toEqual([
      'tailwindcss'
    ]);
  });

  it('returns nothing for a script with no bin references', () => {
    const folder = makeExample({installed: true});
    expect(collectRequiredBins(folder, 'node server.js')).toEqual([]);
  });
});

describe('findMissingInstallParts', () => {
  it('reports a half-installed example even though node_modules exists', () => {
    const folder = makeExample({installed: false});
    const missing = findMissingInstallParts(folder, {dependencies: {'fake-dep': '1.0.0'}}, [
      'tailwindcss'
    ]);

    expect(missing).toEqual([
      {critical: false, label: 'dependency "fake-dep"'},
      {critical: true, label: 'executable "node_modules/.bin/tailwindcss"'}
    ]);
  });

  it('reports nothing for a fully installed example', () => {
    const folder = makeExample({installed: true});

    expect(
      findMissingInstallParts(folder, {dependencies: {'fake-dep': '1.0.0'}}, ['tailwindcss'])
    ).toEqual([]);
  });
});

describe('install-and-start CLI', () => {
  it('reinstalls a half-installed example and then starts it', () => {
    const folder = makeExample({installed: false});
    const {code, output, yarnCalls} = runLauncher(folder, 'start:local', 'install-completes');

    expect(yarnCalls).toEqual(['install', 'start:local']);
    expect(output).toContain('node_modules/.bin/tailwindcss');
    expect(code).toBe(0);
  });

  it('does not reinstall an example that is already complete', () => {
    const folder = makeExample({installed: true});
    const {code, yarnCalls} = runLauncher(folder, 'start:local', 'install-completes');

    expect(yarnCalls).toEqual(['start:local']);
    expect(code).toBe(0);
  });

  it('starts with a warning when only a declared dependency is unaccounted for', () => {
    const folder = makeExample({installed: false});
    const {code, output, yarnCalls} = runLauncher(folder, 'start:local', 'install-bins-only');

    expect(yarnCalls).toEqual(['install', 'start:local']);
    expect(output).toContain('dependency "fake-dep"');
    expect(code).toBe(0);
  });

  it('exits non-zero naming the missing executable when the install leaves it out', () => {
    const folder = makeExample({installed: false});
    const {code, output} = runLauncher(folder, 'start:local', 'install-noop');

    expect(code).not.toBe(0);
    expect(output).toContain('node_modules/.bin/tailwindcss');
    expect(output).toContain(folder);
    expect(output).toContain('yarn install');
  });

  it('reports the folder, command and exit code when the install fails', () => {
    const folder = makeExample({installed: false});
    const {code, output} = runLauncher(folder, 'start:local', 'install-fails');

    expect(code).toBe(7);
    expect(output).toContain(folder);
    expect(output).toContain('yarn install');
    expect(output).toContain('exit   : 7');
  });

  it('propagates the child exit code when the start script fails', () => {
    const folder = makeExample({installed: true});
    const {code, output} = runLauncher(folder, 'start:local', 'run-fails');

    expect(code).toBe(3);
    expect(output).toContain(folder);
    expect(output).toContain('yarn start:local');
    expect(output).toContain('exit   : 3');
  });

  it('fails loudly for a script name the example does not define', () => {
    const folder = makeExample({installed: true});
    const {code, output, yarnCalls} = runLauncher(folder, 'start-local-https', 'install-completes');

    expect(code).not.toBe(0);
    expect(yarnCalls).toEqual([]);
    expect(output).toContain('start-local-https');
    expect(output).toContain('start:local');
  });
});
