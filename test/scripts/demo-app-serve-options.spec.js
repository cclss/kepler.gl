// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  SERVE_DIR,
  SERVE_FALLBACK,
  describeServeOptionError,
  formatServeTarget,
  resolveServeOptions,
  serveUrl
} = require('../../examples/demo-app/serve-options');

const {REQUIRED_START_INPUTS} = require('../../examples/demo-app/start-diagnostics');

const DEMO_APP_DIR = path.resolve(__dirname, '../../examples/demo-app');
const CONFIG_SOURCE = fs.readFileSync(path.join(DEMO_APP_DIR, 'esbuild.config.mjs'), 'utf8');

describe('resolveServeOptions', () => {
  it('binds 0.0.0.0:8080 and serves dist with an index.html fallback by default', () => {
    expect(resolveServeOptions({})).toEqual({
      host: '0.0.0.0',
      port: 8080,
      servedir: 'dist',
      fallback: 'dist/index.html'
    });
    expect(DEFAULT_HOST).toBe('0.0.0.0');
    expect(DEFAULT_PORT).toBe(8080);
  });

  it('honors PORT and HOST from the environment', () => {
    expect(resolveServeOptions({PORT: '3000', HOST: '127.0.0.1'})).toEqual({
      host: '127.0.0.1',
      port: 3000,
      servedir: SERVE_DIR,
      fallback: SERVE_FALLBACK
    });
  });

  it('falls back to the defaults when PORT/HOST are empty or blank', () => {
    expect(resolveServeOptions({PORT: '', HOST: ''})).toMatchObject({host: '0.0.0.0', port: 8080});
    expect(resolveServeOptions({PORT: '  ', HOST: '  '})).toMatchObject({
      host: '0.0.0.0',
      port: 8080
    });
  });

  it('trims surrounding whitespace instead of rejecting the value', () => {
    expect(resolveServeOptions({PORT: ' 4000 ', HOST: ' example.internal '})).toMatchObject({
      host: 'example.internal',
      port: 4000
    });
  });

  it.each(['abc', '80.5', '-1', '0', '65536', '8080abc'])(
    'rejects PORT=%p loudly instead of silently serving another port',
    value => {
      expect(() => resolveServeOptions({PORT: value})).toThrow(/PORT/);
      expect(() => resolveServeOptions({PORT: value})).toThrow(new RegExp(String(value)));
    }
  );

  it('never returns a port outside the range it accepts', () => {
    expect(resolveServeOptions({PORT: '1'}).port).toBe(1);
    expect(resolveServeOptions({PORT: '65535'}).port).toBe(65535);
  });
});

describe('serveUrl', () => {
  it('reports a wildcard bind as localhost, since 0.0.0.0 is not connectable', () => {
    expect(serveUrl({host: '0.0.0.0', port: 8080})).toBe('http://localhost:8080');
    expect(serveUrl({host: '::', port: 8080})).toBe('http://localhost:8080');
  });

  it('uses a concrete host as-is', () => {
    expect(serveUrl({host: '127.0.0.1', port: 3000})).toBe('http://127.0.0.1:3000');
  });

  it('brackets an IPv6 literal host', () => {
    expect(serveUrl({host: '::1', port: 8080})).toBe('http://[::1]:8080');
  });
});

describe('formatServeTarget', () => {
  it('prints the resolved bind so the preview target can be compared to it', () => {
    const line = formatServeTarget({host: '0.0.0.0', port: 8080});

    expect(line).toContain('0.0.0.0:8080');
    expect(line).toContain('http://localhost:8080');
    expect(line).toContain('kepler.gl demo app');
  });

  it('reflects an overridden bind rather than the default', () => {
    const line = formatServeTarget({host: '127.0.0.1', port: 3000});

    expect(line).toContain('127.0.0.1:3000');
    expect(line).not.toContain('8080');
  });
});

describe('describeServeOptionError', () => {
  it('names the offending variable on a failure-marked line', () => {
    let message;
    try {
      resolveServeOptions({PORT: 'abc'});
    } catch (error) {
      message = describeServeOptionError(error);
    }

    expect(message).toContain('✖');
    expect(message).toContain('demo-app --start failed');
    expect(message).toContain('PORT');
  });
});

describe('esbuild.config.mjs serve wiring', () => {
  it('passes the resolved host and port to ctx.serve', () => {
    expect(CONFIG_SOURCE).toMatch(/host:\s*serveOptions\.host/);
    expect(CONFIG_SOURCE).toMatch(/port:\s*serveOptions\.port/);
  });

  it('keeps servedir and the SPA fallback wired to the helper', () => {
    expect(CONFIG_SOURCE).toMatch(/servedir:\s*serveOptions\.servedir/);
    expect(CONFIG_SOURCE).toMatch(/fallback:\s*serveOptions\.fallback/);
  });

  it('no longer hard-codes a port literal in the config', () => {
    expect(CONFIG_SOURCE).not.toMatch(/const\s+port\s*=/);
  });

  it('logs the resolved target at startup', () => {
    expect(CONFIG_SOURCE).toContain('formatServeTarget');
  });

  it('keeps the served fallback document in the start-time required inputs', () => {
    expect(REQUIRED_START_INPUTS.map(input => input.path)).toContain(SERVE_FALLBACK);
  });
});
