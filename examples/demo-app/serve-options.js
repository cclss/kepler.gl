// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

/**
 * Serve options for `node esbuild.config.mjs --start`.
 *
 * The dev server's listen address is what a preview points at, so it must be
 * predictable and verifiable: bound explicitly (not left to a library default
 * that could change), overridable through the environment, and printed at
 * startup as an address someone can compare against the preview target.
 *
 * Deliberately CommonJS and side-effect free so both the ESM esbuild config
 * and the test suite can use it.
 */

/** Listen on every interface: a container's preview reaches the app from outside. */
const DEFAULT_HOST = '0.0.0.0';

/** The port the board preview is wired to. Changing it breaks the preview. */
const DEFAULT_PORT = 8080;

/** Built output esbuild serves, and the document every unmatched path falls back to. */
const SERVE_DIR = 'dist';
const SERVE_FALLBACK = 'dist/index.html';

/** Wildcard binds: correct to listen on, useless to open a browser at. */
const WILDCARD_HOSTS = ['0.0.0.0', '::', '[::]'];

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * @param {string|undefined} raw value of `PORT`
 * @returns {number} the port to listen on
 * @throws {Error} when `PORT` is set to something that is not a usable port —
 *   silently falling back to 8080 would hide the fact that the requested
 *   address is not the one being served. Port 0 ("pick any free port") is
 *   rejected for the same reason: the preview could not be pointed at it.
 */
function resolvePort(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') {
    return DEFAULT_PORT;
  }

  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(
      `PORT="${raw}" is not a usable port (expected an integer ${MIN_PORT}-${MAX_PORT})`
    );
  }

  return port;
}

/**
 * @param {string|undefined} raw value of `HOST`
 * @returns {string} the interface to bind to
 */
function resolveHost(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value === '' ? DEFAULT_HOST : value;
}

/**
 * Everything `ctx.serve` needs, resolved from the environment in one place.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{host: string, port: number, servedir: string, fallback: string}}
 */
function resolveServeOptions(env = {}) {
  return {
    host: resolveHost(env.HOST),
    port: resolvePort(env.PORT),
    servedir: SERVE_DIR,
    fallback: SERVE_FALLBACK
  };
}

/**
 * The address to open in a browser. A wildcard bind is not connectable, so it
 * is reported as `localhost` while the bind itself is still printed verbatim.
 *
 * @param {{host: string, port: number}} options
 * @returns {string}
 */
function serveUrl({host, port}) {
  const target = WILDCARD_HOSTS.includes(host) ? 'localhost' : host;
  // IPv6 literals need brackets in a URL authority.
  const authority = target.includes(':') && !target.startsWith('[') ? `[${target}]` : target;
  return `http://${authority}:${port}`;
}

/**
 * The startup line. States the bind exactly as it was resolved — that is the
 * value a preview target has to match — and then the address to open.
 *
 * @param {{host: string, port: number}} options
 * @returns {string}
 */
function formatServeTarget({host, port}) {
  return `kepler.gl demo app listening on ${host}:${port} — open ${serveUrl({
    host,
    port
  })}, press Ctrl+C to stop`;
}

/**
 * Headline for an unusable serve option. One line, same failure marker as the
 * rest of the start path, naming the environment variable at fault.
 *
 * @param {Error} error
 * @returns {string}
 */
function describeServeOptionError(error) {
  return `✖ demo-app --start failed: ${(error && error.message) || 'invalid serve options'}`;
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  SERVE_DIR,
  SERVE_FALLBACK,
  describeServeOptionError,
  formatServeTarget,
  resolveHost,
  resolvePort,
  resolveServeOptions,
  serveUrl
};
