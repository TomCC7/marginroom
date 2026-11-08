# Marginroom private alpha verification

## Provenance and publication boundary

- Upstream baseline: `c089565bc398b78dfd83d2c2ccf70fb8a834b363`, MIT copyright Alexa Griffith, source `alexagriffith/markmyword`.
- Original committed upstream ancestry is retained. No live runtime data/history was imported. Historical upstream demo media remains in upstream commits, but has been removed from the candidate tree and is not presented as Marginroom media.
- `source-snapshot.json` records 52 explicitly allowlisted code/license/test files and the original source SHA-256 hashes, including all six dirty existing source files and six new source/test helpers. The unchanged deployed topbar/sidebar/mobile assets are included; no installer-output folders, real-document reports, databases, cookies, keys or screenshots were copied.
- A read-only recheck of the original source confirmed all 52 snapshot hashes still matched. Release changes to eight snapshot files are intentional: package identity/scripts/engine/security-patch lock, landing/viewer branding, viewer sanitization/portable export, server safety/default binding, and current-v3 UI tests. Snapshot hashes describe the original source, not the modified candidate.
- `publication-allowlist.json` is an explicit file-path inventory. `node scripts/audit-release.mjs` checks tracked paths, regular files, source ancestry/completeness, local privacy patterns and every reachable historical text blob. `.gitignore`/`.dockerignore` exclude local data, keys, scratch evidence, review artifacts and uploads. Only a synthetic example and generated synthetic screenshot are shipped.

## Executed checks

Runtime: host Node **22.23.4**, Docker Node **22.23.4**, SQLite native module 13.0.3, jsdom 29.1.1. The engine range deliberately targets the tested Node 22 patch baseline rather than assuming every Node 22 release works.

- `npm ci`: passed; 109 packages installed, zero known advisories.
- `npm test`: passed **17 unit/DOM files and 8 real isolated API files**, including all eight v3 API subtests. Legacy toolbar assertions were reproduced as failing and replaced with actual v3 shell contracts; other safety tests were retained.
- `npm run test:browser`: **17** Chromium viewport/capability/layout cases passed, with no page errors or unexpected external requests/writes. Covers latest topbar controls, sidebar/wheel ownership, mobile drawer/navigation and editing drafts.
- `npm run test:security`: **23** synthetic isolated checks passed, including real Chromium execution probes, document/asset traversal, denied direct write/accept/reject/restore, sandbox isolation and source-ownership boundaries.
- `npm run test:acceptance`: passed against a real fresh `npm start` process on a random loopback port. Browser UI uploaded invented HTML and a two-frame GIF through the real missing-image picker; a separate anonymous browser commented and submitted paragraph rewrites; owner UI accepted/rejected; a pending rewrite remained locked and unexported. Export contained accepted text, unchanged rejected/pending text, no review decoration/discussion, and byte-identical embedded GIF. Exported image decoded with network denied. Process restart retained signed owner-cookie privileges, accepted text, four review records and asset bytes.
- `npm run test:all`: all four groups above passed together.
- `npm audit` and `npm audit --omit=dev`: zero known advisories after focused transitive patches. No gratuitous major upgrade.
- Docker build and actual default-CMD execution passed, using a new volume, non-root UID and no published port in the final finite harness. Child-process restart retained identity and review state. Consistent SQLite backup and isolated restore passed with original owner cookie and overlay. An earlier richer 8-file fixture also verified raw HTML, asset/config, comment/history and cookie-loss key recovery. See `operations-evidence.md` for exact commands, observed failures/fixes, and disposable-resource cleanup notes.
- `docker compose -p marginroom-candidate config --quiet`: passed; configuration binds loopback only. Full Compose up/healthcheck lifecycle was not exercised.
- Gitleaks 8.30.0 full intended Git history scan: passed with default rules plus an exact path-and-literal allowlist for the two documented disposable v3 regression credentials. The initial unallowlisted scan flagged only those known synthetic literals; no blanket test-directory exclusion. Local privacy-pattern history inspection also passed. Binary content is not a proof of secret absence; shipped synthetic screenshot was visually checked and upstream media provenance is retained rather than represented as newly authored work.
- `git diff --check`: passed. Final candidate SHA and clean-tree verification are supplied in the reviewer handoff, avoiding a self-referential SHA in this file.

## Focused release fixes

1. Strip nested frames/plugins, inline handlers, SVG mutation tags and decoded script URLs from static inline rendering. Interactive source stays in an opaque-origin sandbox.
2. Serve uploaded assets with restrictive sandbox CSP and `nosniff`, including direct SVG navigation.
3. Reserve `.raw` document IDs to stop source-file/owner collisions.
4. Embed uploaded local static `<img src>` bytes into clean HTML exports without re-encoding GIFs or fetching remote hosts.
5. Native server defaults to loopback; Docker explicitly binds internally with loopback-only Compose publishing.
6. Backup normalizes SQLite snapshots to DELETE journal mode for read-only restore validation; secrets/docs/state are restored together with integrity/hash checks and writes-stopped precondition.

## Known limitations / not claimed

- Trusted private alpha, not public-hosting or open-source-readiness certification, penetration testing, or a hardened authentication boundary. Display names are not authentication; owner/session keys and browser cookies matter.
- Link access is read/suggest/edit, not account ACLs. Read links expose HTML/assets; assets share global basenames. Limits depend on proxy/forwarded-header behavior and are not robust authorization; use loopback/trusted deployment only pending edge review.
- Only ordinary single-paragraph suggestions are supported in the current v3 UI. Grouped/cross-paragraph/interactive content is comment-only for this workflow. Plain-text edits can lose inline formatting/links.
- Active HTML can make remote-resource requests; downloaded interactive originals retain scripts. A regex-cleaned snapshot is not guaranteed inert and neither export inherits the viewer sandbox. Only open trusted exports.
- Static `<img src>` uploads are bundled; CSS backgrounds, responsive `<picture>` alternatives, remote resources and interactive export dependencies are not generally self-contained. Complex/self-unpacking HTML may not source-patch every generated text change.
- Chromium desktop/mobile viewport simulation only; no physical iPhone, real Safari, HTTPS proxy, load, multiwriter, or disaster-recovery hardware test.
- Backup requires every writer stopped; the flag is an operator assertion, not a lock. Backups contain unencrypted secrets and need private storage. Deleted guest browser cookies cannot be recovered by entering an old display name.
- No push, public release, visibility change, Pages deployment, CI polling, or production service/source/data modification was performed. The reviewer validates the exact local candidate; the supervising parent alone publishes the approved commit to the private repository.
