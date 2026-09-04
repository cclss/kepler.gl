// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

// The repository pins Node and Yarn in four places (`.tool-versions`, `.nvmrc`,
// `package.json` `volta`, `package.json` `packageManager`). Drift between them is
// what makes a contributor's shell resolve a different Node than CI, which in turn
// pushes native dependencies off their prebuilt binaries and into source builds.
//
// These tests lock in both halves of the guard: the real repository is consistent
// today, and changing any single declaration is reported as a mismatch. Everything
// runs against `compareToolVersions`, which is pure, so no repository file is ever
// written -- `readDeclarations` is the only filesystem access and it is read-only.
import path from 'path';

import {
  TOOL_VERSION_FILES,
  compareToolVersions,
  formatReport,
  readDeclarations
} from '../../scripts/check-tool-versions';

const REPO_ROOT = path.join(__dirname, '..', '..');

const NODE_SOURCES = {
  toolVersions: `${TOOL_VERSION_FILES.toolVersions} (nodejs)`,
  nvmrc: TOOL_VERSION_FILES.nvmrc,
  volta: `${TOOL_VERSION_FILES.packageJson} volta.node`
};

const YARN_SOURCES = {
  toolVersions: `${TOOL_VERSION_FILES.toolVersions} (yarn)`,
  volta: `${TOOL_VERSION_FILES.packageJson} volta.yarn`,
  packageManager: `${TOOL_VERSION_FILES.packageJson} packageManager`
};

// Read once: the declarations are the fixture, and every mismatch case is this
// baseline with exactly one field replaced.
const actual = readDeclarations(REPO_ROOT);
const baseline = () => ({...actual, volta: {...actual.volta}});

describe('scripts/check-tool-versions - the repository as it stands', () => {
  it('reports every declaration in agreement', () => {
    const report = compareToolVersions(actual);

    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('resolves the pinned Node and Yarn versions', () => {
    const {versions} = compareToolVersions(actual);

    expect(versions.node).toBe('20.19.3');
    expect(versions.yarn).toBe('4.4.0');
  });

  it('reads the same version from each individual declaration', () => {
    const {readings} = compareToolVersions(actual);

    expect(readings.node).toEqual({
      [NODE_SOURCES.toolVersions]: '20.19.3',
      [NODE_SOURCES.nvmrc]: '20.19.3',
      [NODE_SOURCES.volta]: '20.19.3'
    });
    expect(readings.yarn).toEqual({
      [YARN_SOURCES.toolVersions]: '4.4.0',
      [YARN_SOURCES.volta]: '4.4.0',
      [YARN_SOURCES.packageManager]: '4.4.0'
    });
  });

  it('summarizes success on a single line', () => {
    const report = compareToolVersions(actual);

    expect(formatReport(report)).toBe('Tool versions are consistent (node 20.19.3, yarn 4.4.0).');
  });
});

describe('scripts/check-tool-versions - one declaration drifting', () => {
  // Each case changes exactly one declaration away from the repository's pin and
  // names the source the checker is expected to single out.
  const cases = [
    {
      name: `${TOOL_VERSION_FILES.toolVersions} pins a different nodejs`,
      tool: 'node',
      source: NODE_SOURCES.toolVersions,
      drifted: '22.11.0',
      declarations: () => ({
        ...baseline(),
        toolVersions: actual.toolVersions.replace('nodejs 20.19.3', 'nodejs 22.11.0')
      })
    },
    {
      name: `${TOOL_VERSION_FILES.nvmrc} pins a different Node`,
      tool: 'node',
      source: NODE_SOURCES.nvmrc,
      drifted: '22.11.0',
      declarations: () => ({...baseline(), nvmrc: '22.11.0\n'})
    },
    {
      name: 'volta.node pins a different Node',
      tool: 'node',
      source: NODE_SOURCES.volta,
      drifted: '18.20.4',
      declarations: () => {
        const declarations = baseline();
        declarations.volta.node = '18.20.4';
        return declarations;
      }
    },
    {
      name: `${TOOL_VERSION_FILES.toolVersions} pins a different yarn`,
      tool: 'yarn',
      source: YARN_SOURCES.toolVersions,
      drifted: '4.5.0',
      declarations: () => ({
        ...baseline(),
        toolVersions: actual.toolVersions.replace('yarn 4.4.0', 'yarn 4.5.0')
      })
    },
    {
      name: 'volta.yarn pins a different Yarn',
      tool: 'yarn',
      source: YARN_SOURCES.volta,
      drifted: '3.6.4',
      declarations: () => {
        const declarations = baseline();
        declarations.volta.yarn = '3.6.4';
        return declarations;
      }
    },
    {
      name: 'packageManager pins a different Yarn',
      tool: 'yarn',
      source: YARN_SOURCES.packageManager,
      drifted: '4.5.0',
      declarations: () => ({...baseline(), packageManager: 'yarn@4.5.0'})
    }
  ];

  cases.forEach(({name, tool, source, drifted, declarations}) => {
    describe(name, () => {
      const report = () => compareToolVersions(declarations());

      it('fails with a mismatch for the affected tool only', () => {
        const {ok, problems} = report();

        expect(ok).toBe(false);
        expect(problems).toHaveLength(1);
        expect(problems[0].tool).toBe(tool);
        expect(problems[0].kind).toBe('mismatch');
      });

      it('refuses to resolve a version for the affected tool', () => {
        const {versions} = report();

        expect(versions[tool]).toBeNull();
        // The untouched tool still agrees with itself.
        expect(versions[tool === 'node' ? 'yarn' : 'node']).not.toBeNull();
      });

      it('points at the declaration that drifted', () => {
        const {problems, readings} = report();

        expect(readings[tool][source]).toBe(drifted);
        expect(problems[0].sources).toContainEqual({source, version: drifted, note: null});
        expect(formatReport({ok: false, problems, versions: {}})).toContain(
          `${source.padEnd(34)} ${drifted}`
        );
      });
    });
  });
});
