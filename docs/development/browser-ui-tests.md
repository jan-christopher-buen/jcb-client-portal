# Browser UI regressions

The separate `ui` GitHub Actions job runs all 48 offer, deliverable and handover regressions. The existing checks job retains formatting, lint, types, unit/integration tests and production build. UI tests use fictional HTTP fixtures in real Chromium, without an API server, database, demo seed, accounts or secrets. This verifies browser recovery behavior, not real-API integration or production readiness.

Use the Node version in `.nvmrc`, then reproduce from the repository root:

```bash
npm ci
npm run build -w @jcb/contracts
browser_root="$(mktemp -d "${TMPDIR:-/tmp}/jcb-browser-ui.XXXXXX")"
trap 'rm -rf -- "$browser_root"' EXIT
export PLAYWRIGHT_BROWSERS_PATH="$browser_root/browsers"
npm install --prefix "$browser_root/tooling" --no-save --package-lock=false --ignore-scripts playwright@1.64.0
node "$browser_root/tooling/node_modules/playwright/cli.js" install --with-deps --no-shell chromium
export JCB_PLAYWRIGHT_MODULE="$browser_root/tooling/node_modules/playwright/index.mjs"
export JCB_BROWSER_EXECUTABLE="$(node --input-type=module -e 'import { pathToFileURL } from "node:url"; const { chromium } = await import(pathToFileURL(process.env.JCB_PLAYWRIGHT_MODULE)); console.log(chromium.executablePath())')"
npm run test:ui
```

On Linux, `--with-deps` installs OS browser libraries and may request elevated permissions. If those libraries are already installed, `install --no-shell chromium` suffices. CI uses Ubuntu 24.04 and installs the libraries explicitly. Playwright 1.64.0 selects its compatible Chromium revision; neither package nor browser enters the application dependencies or lockfile. CI stores tooling and browsers under a unique `$RUNNER_TEMP` directory and removes it in an `always()` step, including after failures during installation or tests. A runner cancellation may interrupt cleanup; GitHub disposes of the hosted runner.

The command runs suites sequentially on loopback ports 5197, 5198 and 5199. Leave those ports free. Each test has a 60-second timeout, browser launch is bounded, and teardown closes Chromium and terminates Vite, escalating to SIGKILL if necessary. Missing tooling, browser startup errors, failed assertions and timeouts fail the command and CI job; nothing is skipped. CI allows five minutes for browser installation, eight for tests and fifteen for the whole job. The shared contracts build must precede Vite startup.

Real-API two-tab journeys remain separate checks. A local run does not establish that this branch's remote GitHub Actions run has passed.
