// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * The contract behind "the preview shows the app, not `Not Found`".
 *
 * Two pure helpers decide whether `node esbuild.config.mjs --start` can serve
 * anything, and where it serves it:
 *
 *   - the preflight (`findMissingStartInputs` / `formatMissingStartInputs`)
 *     must fail *naming the specific file* that is missing, so a half-finished
 *     install is diagnosable instead of silently ending as `Not Found`;
 *   - the serve resolution (`resolvePort` / `resolveHost`) must land on
 *     `0.0.0.0:8080` unless the environment asks otherwise, and must refuse an
 *     unusable `PORT` rather than quietly listening somewhere else.
 *
 * Every filesystem fixture is a temp directory. The repository working tree is
 * read, never written — the final suite asserts exactly that.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  REQUIRED_START_INPUTS,
  findMissingStartInputs,
  formatMissingStartInputs
} = require('../../examples/demo-app/start-diagnostics');

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  resolveHost,
  resolvePort,
  resolveServeOptions
} = require('../../examples/demo-app/serve-options');

const DEMO_APP_DIR = path.resolve(__dirname, '../../examples/demo-app');
const START_COMMAND = 'node esbuild.config.mjs --start';
const CONFIG_SOURCE = fs.readFileSync(path.join(DEMO_APP_DIR, 'esbuild.config.mjs'), 'utf8');

/** Directories this suite created, so the temp-only invariant is checkable. */
const createdFolders = [];
let workdir;

/**
 * A demo-app-shaped temp folder holding every required input, each with
 * recognizable content so a later existence check cannot pass by accident.
 */
function makeInstalledFolder() {
  const folder = fs.mkdtempSync(path.join(workdir, 'preflight-'));
  createdFolders.push(folder);

  REQUIRED_START_INPUTS.forEach(input => {
    const target = path.resolve(folder, input.path);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, `fixture for ${input.path}\n`);
  });

  return folder;
}

/** The same folder with exactly one required input taken away. */
function makeFolderMissing(input) {
  const folder = makeInstalledFolder();
  fs.rmSync(path.resolve(folder, input.path));
  return folder;
}

/** An empty temp folder, standing in for an example that was never installed. */
function makeEmptyFolder() {
  const folder = fs.mkdtempSync(path.join(workdir, 'empty-'));
  createdFolders.push(folder);
  return folder;
}

/** Files under `dir` as relative path -> size:mtime, skipping generated trees. */
function snapshotTree(dir) {
  const snapshot = {};

  const walk = current => {
    fs.readdirSync(current, {withFileTypes: true}).forEach(entry => {
      // Build output and installed packages are not part of the working tree
      // this suite promises to leave alone, and walking them is expensive.
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.yarn') {
        return;
      }

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        return;
      }

      const stats = fs.statSync(full);
      snapshot[path.relative(dir, full)] = `${stats.size}:${stats.mtimeMs}`;
    });
  };

  walk(dir);
  return snapshot;
}

const treeBefore = snapshotTree(DEMO_APP_DIR);

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'kepler-start-preflight-'));
});

afterAll(() => {
  fs.rmSync(workdir, {recursive: true, force: true});
});

describe('preflight: a complete install', () => {
  it('reports no missing input when every required file exists', () => {
    expect(findMissingStartInputs(makeInstalledFolder())).toEqual([]);
  });

  it('never reaches the failure block, because the start path gates on the result', () => {
    // The formatter is only meaningful for a non-empty list; the guarantee for
    // a complete install is that nothing is missing, so the config's gate
    // (`if (missingInputs.length)`) never fires and `--start` proceeds.
    expect(findMissingStartInputs(makeInstalledFolder())).toHaveLength(0);
    expect(CONFIG_SOURCE).toMatch(/if\s*\(missingInputs\.length\)/);
  });

  it('checks more than one path, so an empty result is meaningful', () => {
    expect(REQUIRED_START_INPUTS.length).toBeGreaterThan(1);
    expect(findMissingStartInputs(makeInstalledFolder())).toEqual([]);
  });
});

describe.each(REQUIRED_START_INPUTS.map(input => [input.path, input]))(
  'preflight: %s missing on its own',
  (label, input) => {
    const others = REQUIRED_START_INPUTS.filter(other => other.path !== input.path);

    it('reports that file and only that file', () => {
      expect(findMissingStartInputs(makeFolderMissing(input)).map(found => found.path)).toEqual([
        input.path
      ]);
    });

    it('fails with a message naming this file, its role and its own fix', () => {
      const folder = makeFolderMissing(input);
      const message = formatMissingStartInputs(
        findMissingStartInputs(folder),
        folder,
        START_COMMAND
      );

      expect(message).toContain('✖ demo-app --start failed');
      expect(message).toContain(input.path);
      expect(message).toContain(path.resolve(folder, input.path));
      expect(message).toContain(input.role);
      expect(message).toContain(input.remedy);
    });

    it('does not blame any of the files that are present', () => {
      const folder = makeFolderMissing(input);
      const message = formatMissingStartInputs(
        findMissingStartInputs(folder),
        folder,
        START_COMMAND
      );

      expect(message).toContain('1 required input(s) missing');
      others.forEach(other => {
        expect(message).not.toContain(other.role);
        expect(message).not.toContain(other.remedy);
      });
    });
  }
);

describe('preflight: nothing installed', () => {
  it('lists every required input rather than stopping at the first', () => {
    const folder = makeEmptyFolder();
    const missing = findMissingStartInputs(folder);

    expect(missing.map(found => found.path)).toEqual(REQUIRED_START_INPUTS.map(i => i.path));
    expect(formatMissingStartInputs(missing, folder, START_COMMAND)).toContain(
      `${REQUIRED_START_INPUTS.length} required input(s) missing`
    );
  });

  it('names the folder and the command that failed, so the failure is placeable', () => {
    const folder = makeEmptyFolder();
    const message = formatMissingStartInputs(findMissingStartInputs(folder), folder, START_COMMAND);

    expect(message).toContain(`folder : ${folder}`);
    expect(message).toContain(`command: ${START_COMMAND}`);
  });
});

describe('serve resolution: defaults', () => {
  it('defaults the port to 8080, the port the preview is wired to', () => {
    expect(resolvePort(undefined)).toBe(8080);
    expect(DEFAULT_PORT).toBe(8080);
  });

  it('defaults the host to 0.0.0.0, so the app is reachable from outside', () => {
    expect(resolveHost(undefined)).toBe('0.0.0.0');
    expect(DEFAULT_HOST).toBe('0.0.0.0');
  });

  it('treats an unset, empty or whitespace-only variable the same way', () => {
    ['', '   ', '\t'].forEach(value => {
      expect(resolvePort(value)).toBe(DEFAULT_PORT);
      expect(resolveHost(value)).toBe(DEFAULT_HOST);
    });
  });
});

describe('serve resolution: environment overrides', () => {
  it('uses PORT when it names a usable port', () => {
    expect(resolvePort('3000')).toBe(3000);
    expect(resolvePort(' 4173 ')).toBe(4173);
  });

  it('accepts the whole usable range', () => {
    expect(resolvePort('1')).toBe(1);
    expect(resolvePort('65535')).toBe(65535);
  });

  it('uses HOST verbatim once trimmed', () => {
    expect(resolveHost('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveHost(' preview.internal ')).toBe('preview.internal');
  });

  it('carries both overrides through resolveServeOptions', () => {
    expect(resolveServeOptions({HOST: '127.0.0.1', PORT: '3000'})).toMatchObject({
      host: '127.0.0.1',
      port: 3000
    });
  });
});

describe('serve resolution: an unusable PORT', () => {
  const rejected = ['abc', '80.5', '-1', '0', '65536', '99999', '+8080', '1e4', '0x1f90', '8 080'];

  it.each(rejected)('rejects PORT=%p instead of falling back to 8080', value => {
    expect(() => resolvePort(value)).toThrow();
    expect(() => resolveServeOptions({PORT: value})).toThrow();
  });

  it.each(rejected)('names PORT, the offending value and the usable range for %p', value => {
    let message;
    try {
      resolvePort(value);
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain('PORT');
    expect(message).toContain(value);
    expect(message).toContain('65535');
  });

  it('gives each rejected value its own message rather than one generic string', () => {
    const messages = rejected.map(value => {
      try {
        resolvePort(value);
      } catch (error) {
        return error.message;
      }
      throw new Error(`expected PORT="${value}" to be rejected`);
    });

    expect(new Set(messages).size).toBe(rejected.length);
  });
});

describe('test isolation', () => {
  it('created every fixture inside the OS temp directory', () => {
    expect(createdFolders.length).toBeGreaterThan(0);
    const tmp = fs.realpathSync(os.tmpdir());

    createdFolders.forEach(folder => {
      expect(fs.realpathSync(folder).startsWith(tmp)).toBe(true);
    });
  });

  it('left the demo-app working tree byte-for-byte unchanged', () => {
    expect(snapshotTree(DEMO_APP_DIR)).toEqual(treeBefore);
  });
});
