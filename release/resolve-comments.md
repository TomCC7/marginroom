# In-place comment resolve / reopen

## Contract and root cause

Baseline: `6b7d58176e3b101be2b8c4eb2a66afc75568deb6`.

Resolve previously used `decide(id, 'reject') → refresh(true) → bridge.reload()` and static-preview reconnect. This rebuilt the reviewed source and iframe, losing reading/form/application state. Decoration also included resolved history. A disposable real-server baseline repro confirms that the actual Resolve click disconnects the source/iframe.

Comment decisions now use their own per-target pending operation and the authoritative persisted suggestion returned by reject/reopen. They do not reload, call whole-source decoration, sync block HTML, navigate to another anchor, or remount the discussion/list container. Existing cards are keyed; only status/action fragments and counts change. Filtering out the focused card chooses a nearby control with `preventScroll` and retains local list scroll where its new bounds allow. Body marks and overlay groups contain only unresolved comments; same-anchor counts are recomputed. Dormant text wrappers are inert, preserving existing text nodes on resolve/reopen; an initially resolved range is inserted locally on reopen with native-selection coordinates retained. They are transparent to element picking.

Owner-only visible **重新打开** actions exist in the existing discussion history and full-list resolved/all filters. A reopen does not navigate out of the current filter. Guest controls remain unavailable. Accept/reject of rewrite suggestions retains the existing content-refresh path; accepted source changes are not suppressed.

### API

- Existing `POST /api/suggest/:id/:sid/reject` retains authorization and state checks, adds `suggestion: getSuggestion(...)` to its response.
- New `POST /api/suggest/:id/:sid/reopen` uses the same write limiter, valid-ID check, `ownsDoc` check and document/suggestion linkage. Only `kind=comment,status=rejected` may become `open`. Missing/wrong-document IDs return 404, nonowners 403, already-open/accepted/stale/rewrite records 409. Response is `{ok:true,suggestion}`.
- No schema, storage, identity, source-hash migration or permission changes. No record recreation.
- Per-target duplicate clicks are disabled; failures report an error without optimistic fake success or refresh. Source/frame identity and a mutation generation guard exclude stale responses/polls. Normal polling skips identical records and applies status-only changes without rebuilding source HTML.

## Verification

All browser writes go to random-port disposable servers with fresh synthetic docs/SQLite and random secrets. Nothing targets production comments or original documents.

Commands:

```sh
node test/v3-api.test.mjs
node test/resolve.browser.mjs
node test/draft-diff.browser.mjs
node test/element-context.browser.mjs
node test/element-review.test.mjs
node test/frame-controller.test.mjs
node test/frame-tabs.test.mjs
node test/frame-suggest.test.mjs
node test/frame-messages.test.mjs
```

`resolve.browser.mjs` covers ordinary DOM, static opaque iframe and interactive source iframe at 1440 and 390 CSS pixels. The ordinary renderer is selected through a test-only Article option, not a shipped UI addition. Its input state is seeded directly because the existing ordinary renderer blocks native form editing in read mode; iframe paths use native input. Synthetic host minimum-height allows nonzero outer scroll even for the normally viewport-bounded iframe shell.

Assertions include target/input/frame/card identity, source JS boot/sentinel, input value, nested scroll and target pixel offsets, nonzero discussion scroll, real resolve/reopen persistence, two comments at the same anchor with count 2→1→2, element marks, local filter removal, visible history/list reopen, denied/network failure, target-only duplicate guard, focused source input, active inline draft, unsent reply, selected text on first reopen after reload, stale in-flight poll, guest action absence, and resolved-only reload with no body marks/counts. Browser screenshots are native captures; desktop and mobile before/after were inspected. This is Chromium viewport coverage, not a physical Safari/keyboard claim.

Evidence is local-only under `review-artifacts/resolve/`; it must not be published. Candidate evidence has separate paths from release evidence.

## CURRENT-derived application candidate (parent/operator only)

The candidate is staged independently from CURRENT, then receives only semantic changes from the release baseline. It preserves CURRENT branding, server defaults, source-hash handling, and all untouched assets. It is **not** a release-directory replacement. Expected changed inventory: six frontend files (`annotation-affordances`, `element-review`, `frame-controller`, `review-v3`, `static-frame-controller`, `viewer`) and `server.js`; `db.js` and schema/storage files remain byte-identical to CURRENT.

```sh
INLINE_BASELINE=6b7d58176e3b101be2b8c4eb2a66afc75568deb6 RESOLVE_ONLY=1 \
  node scripts/stage-inline-candidate.mjs "$CURRENT" review-artifacts/resolve/candidate-final
node scripts/install-inline-candidate.mjs check "$CANDIDATE" "$CURRENT" "$NEW_CODE_BACKUP"
node test/inline-cutover.mjs "$CURRENT" "$CANDIDATE"
RESOLVE_SERVER_ROOT="$CANDIDATE" RESOLVE_ARTIFACTS=review-artifacts/resolve/candidate-final-evidence \
  node test/resolve.browser.mjs
```

The candidate needs dependencies available for disposable process tests. Never point its test DB/docs environment at production. The existing guard checks the full code inventory and all before/after SHA-256 values, rejects drift or extra assets, and verifies installed bytes. The disposable rehearsal covers guard/install/rollback and coordinated synthetic SQLite/docs/identity recovery.

After independent review only, the parent coordinates a write freeze and app-level stop/restart. This task does **not** authorize the worker/reviewer to operate a live service, tunnel or deployment.

1. Re-run full-inventory `check` against CURRENT; if any hash/inventory differs, stop and restage/review instead of overwriting. Verify release commit cleanliness and public artifact hashes.
2. Parent freezes all writers and stops the application. With writers stopped, back up the actual SQLite database, documents/assets and identity/secrets together to a new protected operator location, preserving permissions. Use the existing operations backup/restore procedures; do not copy an active WAL database as one file. Keep code backup separate, outside CURRENT.
3. Parent runs `install ... --writers-stopped` with the exact reviewed candidate and a fresh code-backup path. This copies only changed code files, not DB/docs/config; readback is mandatory. No migration command is needed.
4. Parent restarts the app with its unchanged environment/identity, validates owner/guest controls and code/public hashes, and reopens traffic only after verification. Use disposable synthetic documents for mutation checks, never existing user comments.
5. On failure before writes resume, stop the app and run guarded `rollback ... --writers-stopped`, verify old code hashes, then restart old app. After any writes have resumed, do not blindly restore an old data backup: coordinate the matching DB/docs/identity recovery and account for new writes. Review-only resolved/open state uses existing values, but rollback removes the reopen UI/API.

No worker/reviewer cutover, live DB/API mutation, push, CI, or deployment has been performed.
