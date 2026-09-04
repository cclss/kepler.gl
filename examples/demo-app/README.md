# Demo App

This is the src code of kepler.gl demo app. You can copy this folder out and run it locally.

> The AI assistant (panel, control, reducer) comes from the published
> **`@openassistant/kepler-assistant`** package (`^0.0.12`), which temporarily
> vendors the `@kepler.gl/mcp` map surface (this repo's `src/mcp/` module is
> removed for now). kepler.gl is a **static website**: it only provides the map
> surface _interface_ (`@kepler.gl/mcp`) plus a WebSocket listener — it never
> runs an MCP server. Any MCP server (kepler-assistant's own, or any harness
> like Claude Code / Codex driving the map) is **user-provided** and follows the
> `@kepler.gl/mcp` interface, while the command registry executes on the
> in-browser map. See [`docs/NEXT_PLAN.md`](docs/NEXT_PLAN.md) for the permanent
> separation back into a kepler.gl `src/mcp/` module.

#### Pre requirement

- [Node.js ^20.x](http://nodejs.org): We use Node to generate the documentation, run a
  development web server, run tests, and generate distributable files. Depending on your system,
  you can install Node either from source or as a pre-packaged bundle.
- [Yarn 4.4.0](https://yarnpkg.com): We use Yarn to install our Node.js module dependencies
  (rather than using npm). See the detailed [installation instructions][yarn-install].

#### 1. Install Dependencies

Go to the root directory and install the dependencies using yarn:

```sh
yarn bootstrap
```

If install fails while building the `gl` package, use Node 20.19.3 from the repo root `.nvmrc` (`nvm install` / `nvm use`), or see [Troubleshooting: gl package install](../../contributing/DEVELOPERS.md#troubleshooting-gl-package-install).

If `yarn start` errors with missing `@kepler.gl/duckdb/components` (or other workspace `dist/` files), from the repo root run `yarn workspaces foreach -At run stab` or run full `yarn bootstrap` (not only `yarn install`).

Then, go to the `examples/demo-app` directory and install the dependencies using yarn:

```sh
yarn install
```

#### 2. Environment Variables

Create a `.env` file at the root directory by copying from `.env.template`:

```sh
cp .env.template .env
```

Then update the following environment variables in your `.env` file:

```sh
MAPBOX_ACCESS_TOKEN=<your_mapbox_token>
DROPBOX_CLIENT_ID=<your_dropbox_client_id>
MAPBOX_EXPORT_TOKEN=<your_mapbox_export_token>
CARTO_CLIENT_ID=<your_carto_client_id>
FOURSQUARE_CLIENT_ID=<your_foursquare_client_id>
FOURSQUARE_DOMAIN=<your_foursquare_domain>
FOURSQUARE_USER_MAPS_URL=<your_foursquare_user_map_url>
GoogleDriveClientId=<your_google_oauth_web_client_id>
```

For Google Drive, create an OAuth 2.0 **Web application** client in [Google Cloud Console](https://console.cloud.google.com/), enable the **Google Drive API**, and add your demo-app origin (e.g. `http://localhost:8080`) to Authorized JavaScript origins. Only the client ID is required (no API key).

#### 3. Start the app

```sh
yarn start:local
```

The dev server binds to **`http://0.0.0.0:8080`** — every interface, port `8080` — and prints the
address it resolved before it starts serving:

```
kepler.gl demo app listening on 0.0.0.0:8080 — open http://localhost:8080, press Ctrl+C to stop
```

- **Point any preview, port forward or container mapping at port `8080`.** That is the port the
  app actually listens on; a preview connected anywhere else has nothing to show.
- **Deep links and refreshes return the app.** Every path that matches no built file falls back to
  `dist/index.html` (SPA fallback), so `http://localhost:8080/demo/map` and a browser reload both
  render kepler.gl instead of `Not Found`.
- **`HOST` and `PORT` override the bind** (for example `PORT=3000 yarn start:local`). A `PORT` that
  is not a usable port number stops the start with a named error instead of quietly falling back to
  `8080`, so the address you asked for is always the address being served.

#### 4. Reading a start failure

`Not Found` in a preview means the dev server is not running, or the preview is connected to a port
other than `8080`. The terminal holds the reason: every failure on the start path prints a `✖` block
naming the folder, the command and the cause rather than exiting silently.

- `✖ demo-app --start failed: N required input(s) missing` — the start command checks its inputs
  before doing any work. Each entry lists the path, what it is for and the fix. A missing
  `./node_modules/.bin/tailwindcss` means `yarn install` in this folder never finished — run `yarn`
  in `examples/demo-app` again.
- `✖ demo-app --start failed: "<command>" not found on this system` — that executable could not be
  spawned. Install it, or re-run the install that was supposed to provide it.
- `✖ demo-app --start failed: PORT="…" is not a usable port` — `PORT` is set to something other than
  an integer between 1 and 65535.
- `⚠️  "<command>" not found on this system — continuing without it` — an optional helper failed
  (typically the browser opener on a headless machine). The server keeps serving; open the printed
  address yourself.
- `✖ install-and-start failed: …` — from the repo-root `yarn start` launcher, before the app starts
  at all. It names the example folder, the command it ran and that command's exit code.

[yarn-install]: https://yarnpkg.com/getting-started/install
