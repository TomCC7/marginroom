# Entry candidate: operator handoff (not a deployment)

The homepage approval covers entry/navigation only. Continuous paragraph editing and multi-hunk revision algorithms are not included. Existing review, resolve/reopen, inline diff, sidebar removal and preview sizing remain intact.

## Candidate boundary

Build **from CURRENT**, not by copying this checkout over a running application:

```sh
ENTRY_BASELINE_INVENTORY="$INITIAL_INVENTORY" \
  bun scripts/stage-entry-candidate.mjs "$CURRENT" "$NEW_CANDIDATE"
bun scripts/install-inline-candidate.mjs check "$NEW_CANDIDATE" "$CURRENT" "$NEW_BACKUP"
```

The optional initial inventory is the integration-start JSON evidence; its overlaid source hashes must still match. The stage script copies the latest full runtime public inventory and core modules, then overlays exactly its explicit entry paths. It rechecks source inventory/hashes during the snapshot, records every before/after hash, and rejects non-allowlisted changes. Installer checks the entire public inventory and every core module, including **unchanged** paths. Any mismatch means rebuild/reconcile/review—never force overwrite.

Independent CURRENT document-enhancement assets are runtime preservation inputs, not newly authored homepage deliverables. They remain unchanged in the candidate manifest, including the latest document-content JSON. They are deliberately not added to publication history by this task. Do not substitute old content from a source checkout. The local release workspace may contain these ignored CURRENT copies to exercise the exact runtime integrations.

The server metadata extension adds an exact-ID metadata endpoint and `scope=mine` opt-in. Existing `/api/docs` string-array callers and link-reading policy stay compatible. Mine means actual persisted uploader ownership, not administrator access. Metadata respects discussion visibility and uses SQLite timestamps, never filesystem mtime. Titles use the inert HTML5 parser `parse5` (pinned production dependency, previously a development transitive dependency); no scripts or resources are executed.

The candidate also retains release security hardening absent from CURRENT: reserved internal IDs, inert parent-origin renderer boundary, sandboxed asset responses and portable original image export. These are pre-existing reviewed release safeguards, not changes to revision ownership or algorithms. The manifest makes all differences explicit.

## Verification before approval

```sh
bun test/home-entry.browser.mjs
ENTRY_RUNTIME="$NEW_CANDIDATE" bun test/home-entry.browser.mjs
bun test/home-entry-api.test.mjs && bun test/home-entry-ui.test.mjs && bun test/entry-reading.test.mjs
bun test/viewer-ui.test.mjs
bun test/resolve.browser.mjs
bun test/element-context.browser.mjs
bun test/draft-diff.browser.mjs
bun test/security-release.test.mjs
```

All test servers must use disposable synthetic docs/SQLite/identity and loopback random ports. The real-browser entry suite does so internally; `ENTRY_APPROVED_PREVIEW` optionally captures the read-only approved HTML reference at native 1440/1024/390/360 widths. Production endpoints are never test fixtures. API/UI tests additionally cover fresh A/B/admin identities, read-only count privacy, blocked/corrupt storage, image collisions and input-preserving errors. Browser draft tests cover in-page Stay/Discard and save failure; genuine browser departures retain native beforeunload protection.

Use the exact reviewed Git SHA **and** candidate manifest checksum. Source SHA alone does not describe independent CURRENT assets. Independent same-card review must validate the real journey and native design at that tuple before the parent publishes anything.

## Parent-only guarded cutover

This change includes server code and a production parser dependency: **frontend-only atomic assets are insufficient**.

1. Parent confirms exact approved private repository SHA and manifest checksum, stops/fences app writers, and backs up app code, SQLite consistently, document/raw/config/assets directories and identity material using existing operations tooling. Keep credentials out of logs and reports.
2. Re-run the full guarded `check` against the now-stopped CURRENT. On drift, stop and rebuild/re-review. No worker/reviewer may deploy, push, restart, tunnel or mutate live APIs.
3. With a fresh backup destination, parent alone runs:

   ```sh
   bun scripts/install-inline-candidate.mjs install "$NEW_CANDIDATE" "$CURRENT" "$NEW_BACKUP" --writers-stopped
   ```

4. Parent installs the exact lockfile's production dependencies using the pinned Bun version, restarts the existing service under its established supervisor, and performs public **read-only** health/hash checks of the exact changed assets plus representative viewer deep links. Do not report localhost candidate proof as public deployment proof. Keep write freeze until consistency is checked.
5. On failure, stop/fence again and run guarded rollback:

   ```sh
   bun scripts/install-inline-candidate.mjs rollback "$NEW_CANDIDATE" "$CURRENT" "$NEW_BACKUP" --writers-stopped
   ```

   Restore dependency installation from the backed-up lockfile before restarting. The code installer never touches SQLite/docs/identity or service state. Restore data separately only if the operator's consistency plan requires it; never blindly overwrite new writes.

The disposable rehearsal checks refusal on drift, backup byte integrity, installed exact-target readback and full rollback. It is not a live cutover.

## Intentional limits

Recent history and reading state contain only bounded ID/title/timestamps/coordinates/anchors, not source, typed forms, drafts or credentials. They neither grant access nor sync devices. Interactive iframe DOM/forms/application state are not inspected or replayed; trusted controller messages retain only bounded numeric inner-scroll plus shell/stage coordinates, with no private text or selectors. Knowing a reachable document URL still permits reading; absence from Mine/Recent is not privacy. Physical Safari/iPhone remains a device validation gap.

Replacement preserves the existing server review history; it may no longer map to replaced source. The import warning explicitly says so and recommends keep-both. Selected same-name image bytes must match existing global assets; otherwise rename the image and HTML reference rather than silently substituting it.
