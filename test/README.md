# Portable regression tests

Run tests from the repository root with Bun 1.4.4. Suites use synthetic content,
disposable databases and loopback listeners or route-isolated browser fixtures.
Never point them at production data. Browser checks use Chromium viewport and
keyboard simulations. Physical iPhone/Safari selection, touch, keyboard and OS
IME behavior require device trials.

## Installed agent workflow

- `bun run test:agent` installs the standalone binary through an HTTP installer, then checks CLI subprocesses, comment/reply exact-ID readback and restart. It covers bundle/font/module errors, scope/revocation/pairing, versions/locate, browser management, guest quota/deletion, occupied ports and launcher SIGKILL/lease adoption. Set `AGENT_ARTIFACTS` to retain synthetic reports/captures and `FONT_FIXTURE` to select a licensed installed TTF. The default font is `/usr/share/fonts/TTF/OpenSans-Regular.ttf`.
- `bun run test:existing-host` installs a fresh binary and starts a normal `createApp(db)` HTTP host without managed-runner identity injection. It pairs through `pair --host-db DB --server ORIGIN`, imports with the installed CLI, closes/reopens the database and same-port host, then reads back the original credential, review, source and owner. It checks denial of anonymous, owner and invalid-Bearer HTTP bootstrap, wrong-database rejection, revocation and absence of a managed service. `HOST_ARTIFACTS` retains a secret-free receipt.
- `bun run test:import-recovery` checks abrupt exits at publication boundaries.
- `bun test/agent-migration.mjs ORIGINAL_NODE_FIXTURE_DIR` copies a pre-migration synthetic original-driver fixture and checks all rows, columns, schema, HTTP source/feedback, cookie/token identity, transaction rollback, backup/integrity and copied rollback. Capture `app.db`, `before.db`, `docs`, `identity.json`, `credential.json` and `snapshot.json` before driver replacement and include them in the fixture.
- `bun run test:i18n` and `bun run test:api` check localization and API contracts.

## Run the suites

Install dependencies first, then Chromium before browser suites. Before installed
agent or existing-host tests, [build a standalone distribution](../docs/installation.md#source-builds)
from a clean committed tree into the default `../deliverables` directory. The
destination must not exist. To test an existing distribution elsewhere, set
`MARGINROOM_DELIVERABLES` to its absolute directory.

```sh
bun install --frozen-lockfile
bun run test                    # unit/DOM + disposable local API tests, including v3-api
bun run test:unit
bun run test:api
bun run browser:install     # download the Chromium version matching playwright-core
bun run test:browser        # route-isolated frontend regressions, no server needed
bun run test:chrome         # borderless shell, bottom dock, legacy migration, rail list
bun run test:selection      # native list input, double→triple quote, disposable SQLite/export
bun run test:toggle         # bounded 1440/390 discussion toggle + force-open/draft/state safety
bun run test:preview        # static bridge + true viewport/state matrix + disposable DB
bun run test:security       # real isolated negative/security probes (Chromium required)
bun run test:acceptance     # real bun run start + browser/API upload/review/export/restart
bun run test:all            # unit, API, frontend browser, security, release acceptance
bun test/mobile-selection.browser.mjs # isolated 360/390/440/1440 selection + viewport checks
bun test/mobile-selection-storage.mjs # disposable server/DB: precise quote, one submit, draft guard
```

On a minimal Linux host use `bun run browser:install -- --with-deps` to install
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
non-GET requests fail the test. The suite needs no existing data directory or
running app and saves no report files or screenshots.

The browser suite checks desktop/mobile header breakpoints, long titles,
capability-gated modes and owner-only sharing, menus and list filters, sticky and
wheel-scroll-isolated TOC, first/middle/last chapter navigation, measured header
height, mobile discussion geometry and independent scrolling, composer draft
preservation, marker navigation without article jumps, suggest-mode cancellation,
and exact repeated-quote/stale rewrite decoration. `review-ranges.test.mjs` adds
fast UTF-16, surrogate-pair, insertion/deletion and DOM exclusion regressions.

`test:selection` exercises both ordinary authority DOM and the sandbox preview.
Native triple-click can end at the next block's offset 0; only that equivalent
boundary is clamped, never actual sibling text. The fixture tests use real mouse,
keyboard, DOM Ranges and CDP IME, with all API writes denied. The storage test
uploads synthetic HTML into its own temporary server/SQLite, checks persisted
whole-paragraph/repeated-word UTF-16 ranges, accepts one list-item replacement,
then independently parses the viewer's downloaded HTML. It never uses live data.
`LIST_ARTIFACTS`, `TRIPLE_ARTIFACTS`, `STORAGE_ARTIFACTS` optionally save evidence;
normal tests leave the tree clean. `FRONTEND_PUBLIC` can select isolated candidate
assets for fixture tests (the disposable server always serves this checkout).
These tests cover text-only accepted leaf overlays. Untouched sibling inline
markup and original source HTML must remain unchanged.

Route-isolated browser fixtures deny writes; disposable storage/API tests cover
persistence. `test:all` invokes the separate release acceptance harness explicitly.
It also includes both mobile-selection harnesses through `test:selection`. Optional
`SELECTION_SCREENSHOTS=/absolute/output` saves synthetic viewport screenshots;
normal runs do not modify tracked assets.

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

`PREVIEW_ARTIFACTS=/absolute/output bun test/preview-viewport.browser.mjs`
optionally saves viewport screenshots and `viewport-metadata.json`, recording
the actual iframe CSS dimensions separately from the host screenshot dimensions.
`FRONTEND_PUBLIC=/absolute/candidate/public` lets the route-isolated suites verify
staged frontend assets without any production server or document requests.
Scaled cross-origin iframe clicks use real mouse coordinates transformed from
frame-local rectangles because locator clicks in the tested Chromium/Playwright
combination do not compensate for the iframe CSS transform reliably.

Fresh documents default to **Auto · fill available space**. Auto sizes the iframe
viewport to the stage, so opening or closing rails can change responsive
breakpoints. Saved device/custom choices remain valid. Legacy Article preferences
migrate to Auto, and Article is no longer offered.

The zoom menu changes painting scale only, with Fit and 50/75/100/125/150/200%
choices. Output reports layout CSS-pixel dimensions separately from painted
percentage. Use Auto to reset a custom/device layout. Normal paragraph tests use
the unified iframe.

`workspace.browser.mjs` asserts full-width rail edges (240px left, 320px right;
zero external gutter), full column release, neutral device stage, exact scaled
frame bounds, Auto fill and phone panning. Its optional
`WORKSPACE_ARTIFACTS=/absolute/output` captures 1700/1440/1024 expanded/collapsed
desktop/tablet plus Auto and 390/360 Fit/100% states.

`preview-resize.browser.mjs` tests fresh Auto, rail-driven layout resizing vs fixed
preset invariance, percentage zoom, actual mouse and CDP touch resizing, capture
release/cancel/loss, selection/form/JS retention and exact single iframe load,
keyboard arrows/Shift/Enter and custom size input. The visible 28px corner handle
changes real viewport dimensions, not imported content or application/browser
zoom. Optional `RESIZE_ARTIFACTS=/absolute/output` saves Auto and custom states.

`review-chrome.browser.mjs` checks dock pointer/Enter/Space toggling, saved hidden
state and visible restore entry, recovered Auto height, invariant explicit sizes,
source borders, rail list/filter/jump, iframe identity/input/state and unsent drafts
at 1440/1024/1700/360/390. It also tests legacy/corrupt/denied storage and simulated
keyboard geometry. `CHROME_ARTIFACTS=/absolute/output` saves native viewport
captures and measured metrics.

## Browse, annotate and revise

`bun run test:selection` runs native triple-click, mobile press-snapshot, mobile
SQLite, element/static dashboard and element SQLite suites.
`element-review.test.mjs` covers the ordinary authority
picker, identity/fingerprint ambiguity and no detached-node retargeting.
The list-suggest/list-selection-storage scripts use explicit context submission.
They check UTF-16 offsets, native double/triple quotes, hunk overlap, rich
source/cross-block refusal, sibling/inline-shell integrity and exported HTML.
Choosing **Revise inline** opens a temporary native editable projection.
**Annotate** alone does not grant contenteditable or mutate source.

Continuous revision: `bun test/revision-diff.test.mjs && bun test/continuous-revision-api.test.mjs`
checks deterministic grapheme hunks, bidirectional UTF-16 maps, atomic reconciliation,
caller ownership, immutable retries, paragraph-scoped ABA versions, populated legacy
records, split/merge discussion history and both acceptance orders with real SQLite/HTTP.
`bun test/continuous-revision.browser.mjs` exercises ordinary/static 1440/390
save, reentry, distant editing and save/reload, stable IDs/replies, withdrawal/cancel,
foreign overlap and stale draft retention. `bun test/draft-diff.browser.mjs`
checks native undo/redo/IME and inline deletion flow, including long cross-line runs.
`REVISION_RUNTIME` selects an independent CURRENT-derived candidate; optional
`REVISION_ARTIFACTS` selects native screenshot/evidence output.
