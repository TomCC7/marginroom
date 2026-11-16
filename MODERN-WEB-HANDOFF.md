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

## Guarded candidate — parent deployment only
Seven changed assets only: frame-messages.js,review-v3.css,review-v3.js,scope-css.js,static-preview.js,viewer.html,viewer.js. CURRENT-derived candidate retains all 54 public inventory records and the externally updated enhancer/content JSON. ../candidate/files contains replacements; ../candidate/rollback contains original bytes for those same seven paths. Manifest records full before/after/preserved inventories and exact source commit. Full CURRENT-derived tested app is ../current-app; it is not a directory to copy over live.

Reviewer: independently verify manifest, exact full CURRENT inventory/file-set, candidate/repo/tested-app bytes, rollback bytes, preserved external enhancer+JSON; rerun only narrow changed cases and inspect desktop/390 screenshots. Do not deploy/restart/push. If approved complete this card; parent installs.

Parent installation recipe after approval: re-read the exact manifest, require current live public file-set and every before hash to match; otherwise stop and refresh packaging for content-only drift. Keep a private rollback backup. Before EACH replacement recheck the full expected inventory (already installed paths against candidate hashes, remaining paths against current hashes); stage bytes on the same filesystem and atomically replace only each listed path. No service restart is needed for static frontend assets. Never overwrite a public directory, protected JSON, enhancer or any unrelated source/document/DB. Read back installed hashes and public/origin bytes. On the original URL do GET-only native exact-legend drag → Add comment → empty exact-quote composer → cancel; verify real document/overlay/feedback GET snapshots unchanged. Rollback uses the same guards and atomic replacements, only the seven rollback files. Publication remains parent's decision.
