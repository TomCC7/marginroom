# Portable regression tests

Run from the repository root on the tested Node 22.23.4 baseline:

```sh
npm ci
npm test                    # unit/DOM + disposable local API tests, including v3-api
npm run test:unit
npm run test:api
npm run browser:install     # download the Chromium version matching playwright-core
npm run test:browser        # route-isolated frontend regressions, no server needed
npm run test:preview        # static bridge + true viewport/state matrix + disposable DB
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

The preview suite uses synthetic static and interactive dashboards with media
queries, viewport units, a sticky header, fixed footer, modal, nested scroll,
form and JS counter. It checks all four device presets at host widths
1440/1024/390/360, rotation/custom limits, Fit/100%, sidebar resize, exact iframe
load counts and identity, input/application/draft preservation, sandbox and
wrong-source rejection. The disposable storage test imports through the UI and
reads real records to verify repeated-quote UTF-16 offsets after scaled scrolling
and panning, plus frame/nested scroll navigation and guest edit restrictions.
The static bridge test mocks only API submissions and the viewport UI adapter;
the matrix and storage tests use the actual selector/controller.

`PREVIEW_ARTIFACTS=/absolute/output node test/preview-viewport.browser.mjs`
optionally saves viewport screenshots and `viewport-metadata.json`, recording
the actual iframe CSS dimensions separately from the host screenshot dimensions.
`FRONTEND_PUBLIC=/absolute/candidate/public` lets the route-isolated suites verify
staged frontend assets without any production server or document requests.
Scaled cross-origin iframe clicks use real mouse coordinates transformed from
frame-local rectangles because locator clicks in the tested Chromium/Playwright
combination do not compensate for the iframe CSS transform reliably.

Fresh document preferences now default to **Auto · fill available space**. It
sizes the real iframe viewport to the stage, so responsive breakpoints naturally
change as rails open/close. Saved explicit Article/device/custom choices remain
valid. The zoom menu is paint-only (Fit, 50/75/100/125/150/200%); the output shows
layout CSS-pixel dimensions separately from the painted percentage. Use Auto to
reset a custom/device layout. Article-mode suites explicitly select Article.

`workspace.browser.mjs` asserts full-width rail edges (240px left, 320px right;
zero external gutter), full column release, neutral device stage, exact scaled
frame bounds, article max-width and phone panning. Its optional
`WORKSPACE_ARTIFACTS=/absolute/output` captures 1700/1440/1024 expanded/collapsed
desktop/tablet plus article and 390/360 Fit/100% states.

`preview-resize.browser.mjs` tests fresh Auto, rail-driven layout resizing vs fixed
preset invariance, percentage zoom, actual mouse and CDP touch resizing, capture
release/cancel/loss, selection/form/JS retention and exact single iframe load,
keyboard arrows/Shift/Enter and custom size input. The visible 28px corner handle
changes real viewport dimensions, not imported content or application/browser
zoom. Optional `RESIZE_ARTIFACTS=/absolute/output` saves Auto and custom states.
Physical Safari touch/selection/keyboard behavior still needs a device trial.
