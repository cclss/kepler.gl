// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  REQUIRED_START_INPUTS,
  TAILWIND_BIN,
  attachSpawnDiagnostics,
  describeSpawnFailure,
  findMissingStartInputs,
  formatMissingStartInputs
} = require('../../examples/demo-app/start-diagnostics');

const {SERVE_FALLBACK} = require('../../examples/demo-app/serve-options');

const DEMO_APP_CONFIG = path.resolve(__dirname, '../../examples/demo-app/esbuild.config.mjs');
const START_COMMAND = 'node esbuild.config.mjs --start';

/** A name nothing on PATH can resolve, so `spawn` always fails with ENOENT. */
const MISSING_BINARY = 'kepler-gl-no-such-executable-4f2a';

let workdir;

/** A demo-app-shaped folder: everything `--start` needs, or all of it missing. */
function makeStartFolder({complete}) {
  const folder = fs.mkdtempSync(path.join(workdir, 'demo-app-'));

  if (complete) {
    fs.mkdirSync(path.join(folder, 'node_modules', '.bin'), {recursive: true});
    fs.mkdirSync(path.join(folder, 'dist'), {recursive: true});
    fs.mkdirSync(path.join(folder, 'src'), {recursive: true});
    fs.writeFileSync(path.join(folder, 'node_modules', '.bin', 'tailwindcss'), '');
    fs.writeFileSync(path.join(folder, 'dist', 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(folder, 'src', 'main.js'), '');
  }

  return folder;
}

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepler-start-diagnostics-'));
});

afterAll(() => {
  fs.rmSync(workdir, {recursive: true, force: true});
});

describe('findMissingStartInputs', () => {
  it('reports nothing when every input the start path needs is present', () => {
    expect(findMissingStartInputs(makeStartFolder({complete: true}))).toEqual([]);
  });

  it('names the tailwindcss binary when it is renamed away', () => {
    const folder = makeStartFolder({complete: true});
    fs.renameSync(
      path.join(folder, 'node_modules', '.bin', 'tailwindcss'),
      path.join(folder, 'node_modules', '.bin', 'tailwindcss.renamed')
    );

    expect(findMissingStartInputs(folder).map(input => input.path)).toEqual([TAILWIND_BIN]);
  });

  it('reports every missing input of a folder that was never installed', () => {
    expect(findMissingStartInputs(makeStartFolder({complete: false})).map(i => i.path)).toEqual([
      TAILWIND_BIN,
      'dist/index.html',
      'src/main.js'
    ]);
  });

  it('stays in step with the inputs the demo-app start path declares', () => {
    const config = fs.readFileSync(DEMO_APP_CONFIG, 'utf8');

    expect(REQUIRED_START_INPUTS.map(input => input.path)).toEqual([
      TAILWIND_BIN,
      'dist/index.html',
      'src/main.js'
    ]);
    // The watcher spawns the shared constant, and esbuild is pointed at the
    // same entry point / SPA fallback the preflight checks for. The fallback
    // now lives in serve-options.js, so it is checked at its source and
    // through the wiring rather than as a literal in the config.
    expect(config).toMatch(/spawn\(\s*TAILWIND_BIN/);
    expect(config).toContain("entryPoints: ['src/main.js']");
    expect(SERVE_FALLBACK).toBe('dist/index.html');
    expect(config).toMatch(/fallback:\s*serveOptions\.fallback/);
  });
});

describe('formatMissingStartInputs', () => {
  it('names the folder, the command and the absolute path of each missing input', () => {
    const folder = makeStartFolder({complete: false});
    const message = formatMissingStartInputs(findMissingStartInputs(folder), folder, START_COMMAND);

    expect(message).toContain('✖ demo-app --start failed');
    expect(message).toContain(`folder : ${folder}`);
    expect(message).toContain(`command: ${START_COMMAND}`);
    expect(message).toContain(TAILWIND_BIN);
    expect(message).toContain(path.join(folder, 'node_modules', '.bin', 'tailwindcss'));
    expect(message).toContain('run `yarn` in examples/demo-app');
  });
});

describe('describeSpawnFailure', () => {
  it('says the executable was not found, naming it', () => {
    const message = describeSpawnFailure(TAILWIND_BIN, {code: 'ENOENT'});

    expect(message).toContain(TAILWIND_BIN);
    expect(message).toContain('not found on this system');
  });

  it('keeps the underlying message for other spawn errors', () => {
    const message = describeSpawnFailure(TAILWIND_BIN, {
      code: 'EACCES',
      message: 'permission denied'
    });

    expect(message).toContain('permission denied');
  });

  it('marks an optional helper as survivable', () => {
    const message = describeSpawnFailure('xdg-open', {code: 'ENOENT'}, {fatal: false});

    expect(message).toContain('xdg-open');
    expect(message).toContain('continuing without it');
    expect(message).not.toContain('failed');
  });
});

describe('attachSpawnDiagnostics', () => {
  /** Resolves with what was logged for a real, failing spawn. */
  function spawnAndCollect(options) {
    return new Promise(resolve => {
      const log = message => resolve(message);
      attachSpawnDiagnostics(spawn(MISSING_BINARY), {log, ...options});
    });
  }

  it('logs the cause of a missing required executable and reports the failure', async () => {
    const onFailure = jest.fn();
    const message = await spawnAndCollect({command: MISSING_BINARY, onFailure});

    expect(message).toContain(MISSING_BINARY);
    expect(message).toContain('not found on this system');
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('warns but does not fail when an optional helper is missing', async () => {
    const onFailure = jest.fn();
    const message = await spawnAndCollect({command: MISSING_BINARY, fatal: false, onFailure});

    expect(message).toContain('continuing without it');
    expect(onFailure).not.toHaveBeenCalled();
  });
});
