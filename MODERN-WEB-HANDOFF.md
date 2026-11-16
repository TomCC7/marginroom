# Implementation handoff — independent review required

Baseline: exact deployed ddc0c61e60804887f3cf1a554fc51b9a3339114e. Product tree is this branch; final commit and packaging digests are recorded in ../candidate/manifest.json and ../PACKAGING-RECEIPT.json (avoids self-referential Git hashes).

Read MODERN-WEB-AUDIT.md for guide version/IDs/quotes, finding dispositions, reproducible checks, false-positive limits and known test debt. Retained original audit/guidance evidence remains outside this repo unchanged.

Rerun narrow changed cases:
```
node test/modern-web.browser.mjs
node test/modern-web-probes.mjs
APP_DIR=../current-app RUNTIME_ARTIFACTS=../evidence/reviewer-runtime npm run test:runtime-text
npm run test:api
```
Private current-enhancer exact-legend case uses predecessor private-doc.json with APP_DIR=../current-app, PRIVATE_DOC=/home/cc/work/marginroom-runtime-text-comment-fix/private-doc.json and RUNTIME_ARTIFACTS=../reviewer-private. Never commit/attach those screenshots/documents. test/runtime-text-storage.mjs now finds the private legend by exact approved phrase rather than stale first-legend order, and checks that same paragraph after reload.

Synthetic evidence: ../evidence/audit (four viewport menu captures and two modal captures), ../evidence/probes, ../evidence/current-runtime. Real isolated HTTP/SQLite synthetic and private exact-ID persistence/reload both passed at 1440/390. API passed. Unit file frame-suggest still has the predecessor's two c2/c3 assertion failures (17/2); no all-green claim. WebKit binary missing. Physical Safari and real OS IME are unverified. Synthetic Enter/composition-confirm and dirty-draft retention pass.

## Review correction checkpoint (run126)
Preserved 9376a61; no new worktree or broad audit. Three affected product files only relative to that candidate: review-v3.js explicitly supplies actual More/Name/Share opener; viewer.js recognizes case-insensitive stylesheet rel tokens; static-preview.js retains original body style/link sheets only inside the opaque preview (also closes reviewer comment146's computed-style regression). Added four-viewport focusless-pointer/Escape and body/linked computed-style assertions to the existing browser test, preserving keyboard cases. The data stylesheet exercises actual multi-token CSS application without relying on opaque-frame external fetch behavior; the mixed-case/whitespace external link is checked for shell absence and iframe retention.

Fresh run126 logs: ../revision-browser.log, ../revision-probes.log, ../revision-runtime.log, ../revision-private.log, ../revision-api.log. All passed after running probes from repo cwd (an initial wrong-cwd invocation is not counted as pass). CURRENT-derived synthetic/private HTTP/API/SQLite/reload were rerun at 1440/390; no production writes. Existing reviewer evidence remains valid for unchanged cases. Independent re-review should focus only on opener/style cases and fresh exact hash/package checks. git status retains an untracked node_modules dependency link; it is not committed and the whole working tree is not described as clean. Known c2/c3 debt, missing WebKit, physical Safari/real IME limits are unchanged.

## Guarded candidate — parent deployment only
Seven changed assets only: frame-messages.js,review-v3.css,review-v3.js,scope-css.js,static-preview.js,viewer.html,viewer.js. CURRENT-derived candidate retains all 54 public inventory records and the externally updated enhancer/content JSON. ../candidate/files contains replacements; ../candidate/rollback contains original bytes for those same seven paths. Manifest records full before/after/preserved inventories and exact source commit. Full CURRENT-derived tested app is ../current-app; it is not a directory to copy over live.

Reviewer: independently verify manifest, exact full CURRENT inventory/file-set, candidate/repo/tested-app bytes, rollback bytes, preserved external enhancer+JSON; rerun only narrow changed cases and inspect desktop/390 screenshots. Do not deploy/restart/push. If approved complete this card; parent installs.

Parent installation recipe after approval: re-read the exact manifest, require current live public file-set and every before hash to match; otherwise stop and refresh packaging for content-only drift. Keep a private rollback backup. Before EACH replacement recheck the full expected inventory (already installed paths against candidate hashes, remaining paths against current hashes); stage bytes on the same filesystem and atomically replace only each listed path. No service restart is needed for static frontend assets. Never overwrite a public directory, protected JSON, enhancer or any unrelated source/document/DB. Read back installed hashes and public/origin bytes. On the original URL do GET-only native exact-legend drag → Add comment → empty exact-quote composer → cancel; verify real document/overlay/feedback GET snapshots unchanged. Rollback uses the same guards and atomic replacements, only the seven rollback files. Publication remains parent's decision.
