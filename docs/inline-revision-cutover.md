# Inline revision compatibility and cutover

**Parent/operator only. No worker deployment, service restart or real DB mutation.**

This is not an assets-only fix. Install the separately CURRENT-derived `server.js` + `db.js` together with changed public assets and the three new modules. Existing request shapes remain valid; no real records are mass rewritten. Startup adds one nullable `suggestions.source_hash` column. New submissions capture the original stored HTML digest; acceptance refuses changed originals. Existing pending records without that digest retain their conservative base/occurrence checks.

Accepted range entries now retain escaped `text` plus ordered raw UTF-16 `patches` (`base,start,end,old,body`). The viewer and HTML export validate and replay each patch against canonical DOM text. Unaffected inline nodes/citations survive. A prior text-only overlay remains a legacy flattened base (`patchBaseText`), not reconstructed markup. A stale patch is not guessed onto another occurrence.

Acceptance is a single SQLite transaction: verify base/quote, splice, rebase disjoint pending revisions and comments, invalidate overlaps or ambiguous legacy anchors, write version snapshot and status. Insertion on either replacement boundary, or at the same insertion caret, conflicts; adjacent nonempty ranges do not. Exact stale ranges and unresolved whole-block legacy records conservatively block new same-block revisions until processed. Rejected records are never applied.

## Cutover / backup

1. Freeze writes and have the parent stop the app using its normal service manager. Do not copy a live WAL database as a single file.
2. Use SQLite's backup API to a new empty backup location; save documents, identity/session configuration and the complete current code inventory together. Validate backup with `PRAGMA integrity_check`; rehearse recovery in an isolated directory. Retain any WAL/SHM until the stopped writer has been handled correctly.
3. Recheck every `manifest.json` before hash against CURRENT. A changed or extra source asset requires rebuilding/reviewing the candidate, never overwriting newer production code. `scripts/install-inline-candidate.mjs` does guarded code install/rollback only; it does not touch DB or services.
4. Install the reviewed exact candidate, including backend files and new modules, while stopped. Keep live branding and all manifest-preserved hashes. Parent starts the app, checks schema startup, permissions, one GET-only document/records read and exact served afterhashes. Do not perform synthetic acceptance in the real DB.
5. Keep write freeze until verification succeeds. On failed pre-write cutover restore code, DB, documents and identity from the matching snapshot together. Once new accepts exist, rolling back only the frontend/server is **not supported**: old clients would flatten patch overlays. Restore the coordinated snapshot only with explicit operator acknowledgement of writes since backup, or roll forward.

## Reviewer commands and limits

Run from the release checkout with dependencies installed:

```sh
node test/inline-repair-storage.mjs
node test/inline-geometry.browser.mjs
node test/list-selection-storage.mjs
node test/list-suggest.browser.mjs
node --test test/multirange.test.mjs test/v3-api.test.mjs
node test/inline-cutover.mjs CURRENT CANDIDATE
node scripts/install-inline-candidate.mjs check CANDIDATE CURRENT UNUSED_BACKUP
```

For the independent CURRENT-derived runtime, copy CURRENT root modules/package metadata to an isolated runtime, overlay the candidate's manifest-listed files and point `INLINE_SERVER_ROOT` at it when running `inline-repair-storage.mjs`. Never point that runtime at production docs/DB/config.

Parent-only stopped code installation: `node scripts/install-inline-candidate.mjs install CANDIDATE CURRENT NEW_CODE_BACKUP --writers-stopped`. To reverse a failed **pre-write** cutover: `node scripts/install-inline-candidate.mjs rollback CANDIDATE CURRENT MATCHING_CODE_BACKUP --writers-stopped`, plus coordinated DB/docs/identity recovery described above. The flag is an operator attestation, not a service-stop or DB-backup mechanism. All inventory, before/after and preserved hashes are checked before writes and read back afterwards. A partial copy failure keeps the service stopped: restore the coordinated snapshot manually; never resume writes on a mixed tree.

Desktop counts use an available right or left margin. Full-bleed content with no safe margin uses the light-green inline threads and existing discussion rail instead of covering letters. Mobile deliberately has no margin bubbles. Markup splitting can change Chromium glyph bounds by one 1/64 CSS-pixel layout unit; the regression gate checks exact character count, y positions, line heights and wrap, plus this bounded x/width quantization, not a pixel-perfect glyph-shaping claim.

Browser coverage is Chromium with synthetic keyboard visualViewport simulation, not real hardware Safari or its native callout/keyboard. The ordinary non-frame shared controller is separately exercised; the current app's unified static preview stays an opaque iframe. Baseline-only `inline-repro.browser.mjs` reproduces the old disabled-rich-markup bug against `FRONTEND_PUBLIC` extracted from the pre-change commit; it intentionally must not run against the repaired frontend.

Reviewer must natively compare all original reference images and final 1440/1024/390/360 screenshots, then independently exercise existing-comment rich inline caret editing, cancel/submit, both disjoint accept orders, overlap's 查看修订 action, thread grouping and stationary dock toggling. Worker/reviewer do not deploy, restart or push. Parent alone performs exact served afterhash and private remote-SHA verification after approval.
