# Element context refinement — frontend-only

The contextual element popover separates the target/hierarchy row from actions. Parent/child controls only navigate; Child returns to the previously selected branch. Existing SVG icons are 16px with explicit accessible names, disabled route states and focus rings. Mobile keeps element actions in the contextual group and text-range comments in the existing dock.

Only an explicitly selected supported canonical text element offers **原位修改**. It opens the existing temporary inline editor with the element's complete canonical text and a collapsed caret; a leftover native substring or shell Selection is not its editing scope. Native drag/double/triple text selection offers **写批注** only. The obsolete mobile text-range rewrite control is removed. Source images, controls and rich containers remain comment-only, and interactive dynamic documents retain their existing comment-only limitation.

The whole-element editable scope does not become a blind whole-block submission: the existing UTF-16 common-prefix/suffix diff reduces the request to its changed range, retaining the existing source-hash, overlap and rebase contracts. There is no new editor, API, DB change or permission escalation. A full-element draft cannot safely open around a pending revision with the current single-projection controller: the contextual notice says `此处已有修订；请先查看并处理，再修改整个元素`, and **查看修订** opens that record. Disjoint stored suggestions and accepts remain supported by the unchanged backend.

## Bounded verification

- `node test/element-context.browser.mjs`: disposable real server/SQLite; actual pointer p/image/parent/child, whole p/li inline caret/type/cancel/submit/owner accept, safe em/link/sup and comments, minimal word range, disjoint accept/rebase, permissions, native screenshots at 1440/1024/390/360, draft/toggle retention, stale frame substring plus shell Selection, comments-only text quote.
- `node test/inline-geometry.browser.mjs`: mapped 50%/100%, nested scroll/stage pan, ordinary controller, cancellation, simulated visualViewport keyboard and stationary toggle.
- Migrated `element-review.browser.mjs`, `element-review-storage.mjs`, `list-suggest.browser.mjs`, `list-selection-storage.mjs` retain their navigation/source-action/UTF16/export and cross-block guards using the element-only edit entry.
- Existing `mobile-selection.browser.mjs`, `triple-selection.browser.mjs`, unit suites, v3 API and multirange gates remain applicable.

Historical one-off probes that assert the superseded selected-range/sidebar rewrite UX (including `inline-repro.browser.mjs`, `inline-repair-storage.mjs` and older broad acceptance probes) are not current acceptance gates. Do not restore that UX to satisfy those obsolete entry assertions. This change is verified with the bounded commands above, not a claim that every historical script or `test:all` was run. Physical iPhone Safari selection/keyboard testing remains outside Chromium simulation.

## Parent-only asset handoff

Build the deployment candidate independently from CURRENT live public assets and the seven guarded backend/dependency files. Apply only the six frontend semantic diffs (`element-review.js`, `inline-draft.js`, `review-v3.css`, `review-v3.js`, `static-frame-controller.js`, `viewer.html`). Preserve live branding and all other bytes; never copy the release bundle wholesale. Record full before/after SHA256 inventory, including the 27 preserved files. The review bundle carries this candidate and manifest; no production DB/docs/identity are included.

Use `scripts/install-inline-candidate.mjs check CANDIDATE LIVE NEW_BACKUP` read-only before approval. The installer refuses inventory/hash drift and extra files. Parent alone controls cutover; workers/reviewers do not deploy, restart or push. After any approved install verify exact changed public asset hashes and preserved paths. Its `rollback` mode restores **only these six frontend assets** to the already migrated CURRENT baseline. It must never restore old inline backend/DB snapshots or undo the earlier `source_hash` migration. Full inventory guard/install/rollback is rehearsed on a disposable copy by `test/inline-cutover.mjs CURRENT CANDIDATE`; its older log wording mentions backend install, but this manifest marks every backend/dependency file preserved and only the six frontend files are copied to the target.
