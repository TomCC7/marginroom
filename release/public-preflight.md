# Public preflight policy and reviewed inventory

Scope: every GitHub-advertised ref fetched into `refs/audit/*`, all locally reachable objects (a superset), current tracked tree, prior draft release assets and new release artifacts. Preserve history; do not publish if a new actual secret or private user-content finding appears. Evidence with exact ref/object counts, scanner outputs and artifact hashes lives in the task handoff, not in Git.

Primary scanner: official Gitleaks 8.30.1 Linux x64 archive, verified against its official release checksums (SHA256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`). `gitleaks git --log-opts=--all --redact=100` uses default rules extended by the existing `.gitleaks.toml`. The sole narrow credential allowlist remains exact disposable v3 fixture literals in one test. Scan directory contents of extracted prior assets separately. Supplement with `bun scripts/audit-release.mjs`, complete object-path inventory and manual media/content classification. Scanner pass is not a proof no secret exists.

## Ten inherited inventory mismatches, individually reconciled

- `MODERN-WEB-AUDIT.md`: technical frontend findings/guide citations and synthetic test results; mentions protected enhancer names/hashes, not content. No credentials or real user document.
- `MODERN-WEB-HANDOFF.md`: deployment/review instructions and test limits; current paths are placeholders. No actual private fixture included.
- `release/stale-resolution.md`: public API contract and synthetic verification recipe, no runtime records.
- `test/element-location.test.mjs`: jsdom synthetic element-location assertions.
- `test/modern-web-probes.mjs`: synthetic bounded message/poll/referrer tests; disposable sentinel, not a real key.
- `test/modern-web-webkit.mjs`: optional Playwright engine smoke test; no stored sessions.
- `test/modern-web.browser.mjs`: synthetic browser fixtures/focus/style assertions; no private fixture bytes.
- `test/revision-tags-layout.browser.mjs`: synthetic viewport layout test.
- `test/revision-tags.browser.mjs`: synthetic revision/tag HTTP/browser fixtures.
- `test/stale-resolution.mjs`: isolated synthetic SQLite/source/browser lifecycle assertions.

These exact paths, plus this policy, release notes and bounded installer test, are added to the allowlist. No blanket directory exemption.

## Historical developer paths, not user content

Four inherited blobs are exact developer reports containing old local test/deployment directory examples, not documents, tokens, DBs or identities. The audit exempts **only its directory-path pattern** for these exact object IDs; all secret patterns still apply:

- `a48fa16d6acf0de7c8bdedeac0058dee66a6b432`, `9fad049e0d7e9096100fa6c01e70e0198eda5fba`: older `MODERN-WEB-HANDOFF.md`.
- `643f62f5a0dc70d6f075a722e5138ac185d9255d`, `eadc85a9a8a3fd70b68220f6a53fa54e15a84780`: older `release/stale-resolution.md`.

No history rewrite is required for harmless developer examples. This is not approval to commit real documents or their screenshots. Current examples are already placeholder-based.

## Media and private-data boundary

Current screenshots show synthetic field notes / “A calmer review process”; Alex Morgan/Sam Rivera are scripted demo personas (see `test/capture-english-review.mjs`). Historical screenshot/demo blobs originate in upstream storyboard/demo commits: example document, fictional Nova-7B model page and generic shipping/report copy; no user workspace or credential UI. The small animated fixture is generated solid-color frames. Inspect retained contact sheet and original images when reviewing, not a secret-scanner-only claim.

No tracked or historical runtime DB, backup payload, session identity file, credential file, private article or protected `metal-arm-plan*` content was found in the complete reachable object-path inventory. `scripts/backup.mjs` is source code, not a backup payload; `.env.example` is an example, not `.env`. HTML under public is application shell and docs/example.html is an upstream toy document. Original MIT/upstream attribution remains intact. Release archives embed only runtime code/dependencies and the explicit frontend allowlist, not docs/screenshots/test state. The prior draft release must remain audited even if it remains draft when visibility changes.

## Publication ownership

Coder/reviewer do not publish. Parent checks exact approved source SHA and ref freshness, pushes only `feat/macos-release`, creates the proposed prerelease at that SHA, sets that tested branch as default (preserving main), then flips visibility after PASS. Parent must independently read back remote SHA, public visibility, release asset digests and anonymous installer bytes and exercise the literal public curl install in isolated HOME. If refs/releases changed after scan, rescan the delta before publication.
