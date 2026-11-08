# Portable regression tests

Run from the repository root on the tested Node 22.23.4 baseline:

```sh
npm ci
npm test                    # unit/DOM + disposable local API tests, including v3-api
npm run test:unit
npm run test:api
npm run browser:install     # download the Chromium version matching playwright-core
npm run test:browser        # route-isolated frontend regressions, no server needed
npm run test:security       # real isolated negative/security probes (Chromium required)
npm run test:acceptance     # real npm start + browser/API upload/review/export/restart
npm run test:all            # unit, API, frontend browser, security, release acceptance
node test/mobile-selection.browser.mjs # isolated 360/390/440/1440 selection + viewport checks
node test/mobile-selection-storage.mjs # disposable server/DB: precise quote, one submit, draft guard
```

On a minimal Linux host use `npm run browser:install -- --with-deps` to install
browser OS dependencies too (may require elevated permissions). An existing
browser can be selected explicitly with `CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`.
The harness also discovers system Chromium and Playwright's browser cache,
respecting `PLAYWRIGHT_BROWSERS_PATH`.

`run.mjs` lists unit and API suites explicitly. API suites start their own
loopback listeners and use disposable databases; they do not target an existing
server. `v3-api.test.mjs` covers range validation, safe retries, decisions,
permissions, real reply persistence, migration and database reopen.

`frontend.browser.mjs` uses `helpers/browser.mjs` to generate an article,
comments and a long reply thread entirely in memory. Every request is fulfilled
from local public assets or synthetic data; unexpected hosts, API endpoints and
non-GET requests fail the test. There are no live URLs, source snapshots,
private article fixtures, report files or screenshots. No existing data directory
or running app is needed.

The browser suite checks desktop/mobile header breakpoints, long titles,
capability-gated modes and owner-only sharing, menus and list filters, sticky and
wheel-scroll-isolated TOC, first/middle/last chapter navigation, measured header
height, mobile discussion geometry and independent scrolling, composer draft
preservation, marker navigation without article jumps, suggest-mode cancellation,
and exact repeated-quote/stale rewrite decoration. `review-ranges.test.mjs` adds
fast UTF-16, surrogate-pair, insertion/deletion and DOM exclusion regressions.

Browser checks use headless Chromium viewport simulation, not physical iOS,
Safari, or a real software keyboard. They intentionally do not submit writes;
the disposable API tests cover persistence. The separate release acceptance
harness is not implicitly discovered by this runner. The two mobile-selection
harnesses are also explicit commands, not part of `test:all`. Optional
`SELECTION_SCREENSHOTS=/absolute/output` saves synthetic viewport screenshots;
normal runs do not modify tracked assets. Neither harness reproduces iOS native
selection menus: a physical iPhone/Safari selection-menu and keyboard trial is
still required.
